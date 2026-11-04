"""Rack HTTP API: reads the Rack's own files and talks to the durable queue.

Run:   RACK_TOKEN=choose-a-long-random-value uvicorn rack_api:app --host 127.0.0.1 --port 8797
Every write (POST) needs the X-Rack-Token header; so do GET /status and GET /status/stream (they show your log lines).
Starting work only queues a job. rack_actor.py is the only thing that runs a job, and only through admission control.
Nothing here accepts a command line: a start names a recipe from <RACK_DIR>/recipes/*.json.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import rack_recipes
import rack_status_stream
from rack_jobs import DuplicateRequest, atomic_json
from rack_safety import start_refusal, validate_act
from rack_system import monitor

ROOT = Path(os.environ.get('RACK_DIR', Path.home() / 'rack'))
ACTIONS_LOG = 'actions.log'
LIMIT_GB = int(os.environ.get('ADMIT_LIMIT', '90'))

app = FastAPI(title='Rack API')
app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.environ.get('RACK_CORS_ORIGINS', '*').split(',') if o],
                   allow_methods=['GET', 'POST'], allow_headers=['*'])

LOCKED_READS = ('/status', '/status/stream')


def _queue():
    from rack_actor import new_queue
    return new_queue(ROOT)


@app.middleware('http')
async def require_token(request, call_next):
    password = os.environ.get('RACK_OWNER_PASSWORD', '')
    if password:
        cookie = request.cookies.get('rack_owner', '')
        expires, _, supplied = cookie.partition('.')
        expected_owner = hmac.new(password.encode(), ('rack-owner:' + expires).encode(), hashlib.sha256).hexdigest()
        if not expires.isdigit() or int(expires) <= time.time() or not hmac.compare_digest(supplied, expected_owner):
            return JSONResponse({'detail': 'Owner sign-in required.'}, status_code=401)
    if request.method == 'POST' or (request.method == 'GET' and request.url.path in LOCKED_READS):
        expected = os.environ.get('RACK_TOKEN', '')
        provided = request.headers.get('X-Rack-Token', '')
        matches = hmac.compare_digest(hashlib.sha256(expected.encode()).digest(),
                                      hashlib.sha256(provided.encode()).digest())
        if not expected or not provided or not matches:
            logging.getLogger('rack.auth').warning('Rack %s authentication rejected', request.method)
            response = JSONResponse({'detail': 'Unlock controls with a valid Rack token.'}, status_code=401)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
    return await call_next(request)


def _tail(path: Path, n: int) -> list[str]:
    try:
        return path.read_text(encoding='utf-8', errors='replace').splitlines()[-n:]
    except OSError:
        return []


def _memory_gb() -> tuple[float | None, float | None]:
    try:
        info = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            info[key] = int(value.split()[0])
        return (info['MemTotal'] - info['MemAvailable']) / 1048576, info['MemTotal'] / 1048576
    except (OSError, ValueError, KeyError):
        return None, None


def _hold() -> dict:
    path = ROOT / 'HOLD'
    if not path.exists():
        return {'present': False, 'who': None, 'at': None, 'reason': None}
    try:
        body = json.loads(path.read_text(encoding='utf-8') or '{}')
    except ValueError:
        body = {}
    return {'present': True, 'who': body.get('who'), 'at': body.get('at'), 'reason': body.get('reason')}


@app.get('/')
def root():
    return {'name': 'Rack API', 'docs': '/docs', 'live': (ROOT / 'RACK-LIVE').exists()}


@app.get('/status')
def status():
    used, total = _memory_gb()
    return {'live': (ROOT / 'RACK-LIVE').exists(), 'hold_present': (ROOT / 'HOLD').exists(),
            'memory_used_gb': used, 'memory_total_gb': total, 'status_tail': _tail(ROOT / 'STATUS', 20)}


@app.get('/system')
def system():
    return monitor.sample()


@app.get('/slivers')
def slivers():
    used, _ = _memory_gb()
    return {'jobs': _queue().slivers(memory_gb=used, memory_warn_gb=LIMIT_GB)}


@app.get('/recipes')
def recipes():
    return {'recipes': [rack_recipes.availability(ROOT, a) for a in rack_recipes.load(ROOT)]}


@app.get('/admissions')
def admissions():
    rows = []
    for raw in _tail(ROOT / 'ADMISSIONS.md', 50):
        m = re.match(r'^(\S+ \S+) (ADMIT|WAIT)\s+(\S+) peak (\d+): (.*)$', raw)
        rows.append({'time': m.group(1), 'action': m.group(2), 'job': m.group(3), 'peak': int(m.group(4)),
                     'detail': m.group(5), 'raw': raw} if m else {'raw': raw})
    return {'admissions': rows}


@app.get('/activity')
def activity():
    jobs = _queue().jobs()
    counts = {s: sum(1 for j in jobs if j['status'] == s) for s in ('queued', 'running', 'blocked')}
    hold = _hold()
    if hold['present']:
        sentence = 'Paused. Nothing new starts until you resume.'
    elif counts['running']:
        sentence = '%d job%s running.' % (counts['running'], '' if counts['running'] == 1 else 's')
    elif counts['queued']:
        sentence = '%d job%s waiting to start.' % (counts['queued'], '' if counts['queued'] == 1 else 's')
    else:
        sentence = 'Idle. Nothing is running.'
    return {'sentence': sentence, 'hold': hold, **counts}


class PreviewRequest(BaseModel):
    recipe: str


@app.post('/preview')
def preview(body: PreviewRequest):
    """Would this start be admitted right now? Read-only: nothing is recorded or queued."""
    if body.recipe not in rack_recipes.load(ROOT):
        raise HTTPException(400, 'Unknown recipe.')
    info = rack_recipes.availability(ROOT, body.recipe)
    refusal = start_refusal(ROOT, body.recipe, {})
    return {'recipe': body.recipe, 'job': info['admission'], 'admitted': refusal is None,
            'verdict': refusal or 'ADMIT: the memory budget has room for this recipe right now.'}


class ActRequest(BaseModel):
    action: str
    params: dict = {}
    requested_by: str = 'owner'


@app.post('/act')
def act(body: ActRequest):
    try:
        validate_act(ROOT, body.action, body.params, body.requested_by)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    refusal = start_refusal(ROOT, body.action, body.params)
    if refusal:
        raise HTTPException(409, refusal)
    try:
        job = _queue().submit(body.action, body.params, body.requested_by, 'act-' + uuid.uuid4().hex)
    except DuplicateRequest as exc:
        raise HTTPException(409, str(exc))
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    with (ROOT / ACTIONS_LOG).open('a', encoding='utf-8') as f:
        f.write('%s UTC %s by %s job %s\n' % (stamp, body.action, body.requested_by, job))
    return {'ok': True, 'job_id': job, 'note': 'Queued durably; see /slivers for saved progress.'}


@app.get('/actions')
def actions(limit: int = 50):
    return {'rows': _tail(ROOT / ACTIONS_LOG, max(1, min(limit, 200)))}


class LiveRequest(BaseModel):
    live: bool
    who: str = 'owner'


@app.get('/live')
def live_status():
    path = ROOT / 'RACK-LIVE'
    if not path.exists():
        return {'live': False, 'detail': 'Dry-run: requests are recorded but change nothing.'}
    try:
        body = json.loads(path.read_text(encoding='utf-8') or '{}')
    except ValueError:
        body = {}
    return {'live': True, 'by': body.get('who'), 'at': body.get('at')}


@app.post('/live')
def set_live(body: LiveRequest):
    path = ROOT / 'RACK-LIVE'
    if body.live:
        atomic_json(path, {'who': body.who, 'at': datetime.now(timezone.utc).isoformat()})
    else:
        path.unlink(missing_ok=True)
    return {'ok': True, 'live': body.live}


@app.post('/unlock')
def unlock():
    """Reaching here means the token was accepted. Nothing changes."""
    return {'ok': True}


@app.get('/status/stream')
def status_stream(since: int = 0, limit: int = 100, match: str = ''):
    try:
        return rack_status_stream.read_stream(rack_status_stream.base_dir(ROOT), since, limit, match)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
