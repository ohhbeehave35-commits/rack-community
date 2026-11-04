"""Durable job queue and atomic, resumable piece results (standard library only).

A job is a named action plus parameters. Its work is split into named pieces. Each
piece result is saved atomically, so a crash or a restart resumes at the first piece
that was not saved. Nothing here starts a process; rack_actor.py does that.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

MAX_PIECE_SECONDS = 600


class DuplicateRequest(ValueError):
    pass


def _fsync_dir(directory):
    if os.name == 'posix':
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def atomic_text(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with tmp.open('w', encoding='utf-8') as f:
            f.write(value)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        _fsync_dir(path.parent)
    finally:
        tmp.unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_text(path, json.dumps(value, ensure_ascii=True, allow_nan=False))


class JobQueue:
    def __init__(self, root, unique_actions=()):
        """unique_actions: action names that may have only one active copy at a time."""
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / 'jobs.sqlite3'
        self.unique_actions = set(unique_actions)
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, action TEXT NOT NULL, params TEXT NOT NULL,
                who TEXT NOT NULL, resume_key TEXT UNIQUE NOT NULL,
                fingerprint TEXT NOT NULL, created REAL NOT NULL,
                status TEXT NOT NULL, started REAL, deadline REAL, detail TEXT NOT NULL DEFAULT '')''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def submit(self, action, params, who, resume_key, now=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            return self.submit_in_transaction(db, action, params, who, resume_key, now)

    def submit_in_transaction(self, db, action, params, who, resume_key, now=None):
        if not isinstance(resume_key, str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', resume_key):
            raise ValueError('a valid resume key is required')
        now = time.time() if now is None else now
        encoded = json.dumps(params, sort_keys=True, separators=(',', ':'), allow_nan=False)
        fingerprint = hashlib.sha256((action + '\n' + encoded).encode()).hexdigest()
        job = uuid.uuid4().hex
        if db.execute('SELECT 1 FROM jobs WHERE fingerprint=? AND created>?', (fingerprint, now - 60)).fetchone():
            raise DuplicateRequest('Same action and parameters already requested within 60 seconds; nothing queued.')
        if action in self.unique_actions:
            if db.execute("SELECT 1 FROM jobs WHERE fingerprint=? AND status IN ('queued','running','blocked')",
                          (fingerprint,)).fetchone():
                raise DuplicateRequest('This work already has an active or blocked job; use its saved progress.')
        if db.execute('SELECT 1 FROM jobs WHERE resume_key=?', (resume_key,)).fetchone():
            raise ValueError('resume key already belongs to a job')
        db.execute('INSERT INTO jobs(id,action,params,who,resume_key,fingerprint,created,status) VALUES(?,?,?,?,?,?,?,?)',
                   (job, action, encoded, who, resume_key, fingerprint, now, 'queued'))
        return job

    def update(self, job, **fields):
        if not fields or set(fields) - {'status', 'started', 'deadline', 'detail'}:
            raise ValueError('invalid job update')
        with self.connect() as db:
            db.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=?', (*fields.values(), job))

    def jobs(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM jobs ORDER BY created,id')]

    def job(self, job):
        with self.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
        if row is None:
            raise ValueError('unknown job')
        return dict(row)

    def slivers(self, now=None, memory_gb=None, memory_warn_gb=None):
        """One progress row per job: pieces saved, last save, next deadline, stall and memory warnings."""
        now = time.time() if now is None else now
        rows = []
        for job in self.jobs():
            p = Pieces(self, job['id'], job['resume_key'])
            saved = p.saved()
            last = max((v['saved_at'] for v in saved), default=None)
            running = job['status'] == 'running'
            rows.append(dict(id=job['id'], name=job['action'], status=job['status'],
                             piece=len(saved), total=len(p.names()) or None,
                             last_durable_save=last, next_deadline=job['deadline'],
                             newest_output=saved[-1]['output'] if saved else None,
                             state='waiting' if job['status'] in ('queued', 'blocked') else job['status'],
                             stalled=running and job['deadline'] is not None and now >= job['deadline'],
                             memory_high=bool(running and memory_gb is not None and memory_warn_gb is not None
                                              and memory_gb > memory_warn_gb),
                             detail=job['detail']))
        return rows


class Pieces:
    def __init__(self, queue, job_id, resume_key):
        job = queue.job(job_id)
        if not resume_key or job['resume_key'] != resume_key:
            raise ValueError('matching resume key is required')
        self.queue, self.job_id = queue, job_id
        self.directory = queue.root / job_id
        self.directory.mkdir(parents=True, exist_ok=True)
        self.manifest = self.directory / 'plan.json'

    def names(self):
        return json.loads(self.manifest.read_text(encoding='utf-8')) if self.manifest.exists() else []

    def plan(self, names):
        if len(names) != len(set(names)) or not names:
            raise ValueError('nonempty unique piece names required')
        if self.manifest.exists():
            if self.names() != names:
                raise ValueError('job inputs/plan changed; refusing unsafe resume')
        else:
            atomic_json(self.manifest, names)

    def path(self, name):
        return self.directory / (hashlib.sha256(name.encode()).hexdigest() + '.json')

    def saved(self):
        result = []
        for name in self.names():
            path = self.path(name)
            if path.exists():
                rec = json.loads(path.read_text(encoding='utf-8'))
                result.append({**rec, 'output': str(path)})
        return result

    def get(self, name):
        path = self.path(name)
        return json.loads(path.read_text(encoding='utf-8'))['result'] if path.exists() else None

    def save(self, name, result):
        if name not in self.names():
            raise ValueError('piece not in durable plan')
        names = self.names()
        if any(not self.path(previous).exists() for previous in names[:names.index(name)]):
            raise ValueError('previous piece is not durable; refusing to advance')
        if self.path(name).exists():
            return
        with self.queue.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            atomic_json(self.path(name), {'name': name, 'saved_at': time.time(), 'result': result})
            db.execute("UPDATE jobs SET deadline=NULL, detail=CASE WHEN status='running' THEN 'Running; each finished piece is saved.' ELSE detail END WHERE id=?", (self.job_id,))

    def begin(self, name):
        if name not in self.names():
            raise ValueError('piece not in durable plan')
        if self.path(name).exists():
            return
        if self.queue.job(self.job_id)['deadline'] is not None:
            return  # Re-entering a piece must never extend its clock.
        limit = min(MAX_PIECE_SECONDS, float(os.environ.get('RACK_PIECE_SECONDS', MAX_PIECE_SECONDS)))
        self.queue.update(self.job_id, deadline=time.time() + limit)

    def run(self, name, fn):
        path = self.path(name)
        if path.exists():
            return json.loads(path.read_text(encoding='utf-8'))['result']
        # The supervisor enforces the wall-clock ceiling, including blocked native calls.
        self.begin(name)
        result = fn()
        self.save(name, result)
        return result


_CONTEXT = None


def from_environment():
    """Used by a recipe script: the actor passes the job id, resume key and queue folder in the environment."""
    global _CONTEXT
    if _CONTEXT is not None:
        return _CONTEXT
    if not os.environ.get('RACK_JOB_ID') or not os.environ.get('RACK_RESUME_KEY'):
        raise ValueError('job runner requires a resume key and job id')
    p = Pieces(JobQueue(os.environ['RACK_QUEUE_ROOT']), os.environ['RACK_JOB_ID'], os.environ['RACK_RESUME_KEY'])
    if p.path('finish').exists():
        raise SystemExit(0)
    _CONTEXT = p
    # Deadline enforcement lives outside this worker, in rack_supervisor.py.
    return p
