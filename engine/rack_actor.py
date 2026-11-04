"""The actor: one durable queue, one admitted child at a time, hard piece deadlines.

Controls (pause, resume, stop, retry) are serviced before any queued recipe. Work only runs when the Rack is LIVE
(a RACK-LIVE file exists); otherwise a request is recorded as a dry run and nothing changes.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from rack_jobs import JobQueue, Pieces, MAX_PIECE_SECONDS, atomic_json
from rack_recipes import command as recipe_command, load as load_recipes
from rack_safety import CONTROL_ACTIONS, start_refusal, validate_act

STARTUP_SECONDS = 600
ROOT = Path(os.environ.get('RACK_DIR', Path.home() / 'rack'))


@contextmanager
def actor_lock(root):
    # Lifetime OS lock: released on crash; inherited by the worker process so a
    # second actor cannot launch a duplicate while an orphan worker still lives.
    import fcntl
    with (Path(root) / 'actor.lock').open('a') as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield f.fileno()


def live(root):
    return (Path(root) / 'RACK-LIVE').exists()


def new_queue(root):
    return JobQueue(Path(root) / 'jobs', unique_actions=load_recipes(root))


def control(q, job, root):
    p = Pieces(q, job['id'], job['resume_key'])
    p.plan(['control'])
    params = json.loads(job['params'])
    if not live(root):
        q.update(job['id'], status='dry_run', detail='Would apply; the Rack is in dry-run mode.')
        return

    def apply():
        if job['action'] == 'retry_job':
            target = q.job(params['job_id'])
            refusal = start_refusal(root, target['action'], json.loads(target['params']))
            if refusal:
                raise ValueError(refusal)
            q.update(target['id'], status='queued', deadline=None,
                     detail='Owner requested resume from the last saved piece; original inputs and resume key retained.')
        elif job['action'] in ('pause', 'stop'):
            # One pause mechanism: a HOLD marker in the Rack folder. An existing hold keeps its original reason.
            if not (root / 'HOLD').exists():
                atomic_json(root / 'HOLD', {'who': job['who'], 'at': datetime.now(timezone.utc).isoformat(),
                                            'reason': params.get('reason') or ('Owner stop' if job['action'] == 'stop' else 'Owner pause')})
        elif job['action'] == 'resume':
            (root / 'HOLD').unlink(missing_ok=True)
        else:
            raise ValueError('unknown control')
        return {'applied': job['action']}
    p.run('control', apply)
    q.update(job['id'], status='done', deadline=None, detail='Applied.')


def terminate_child(child):
    # Only the process group this actor created; never process-name matching.
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
    child.wait()


def wait_for_later_hold(q, job, root):
    """A pause keeps work that was queued before the HOLD; new starts after it are refused."""
    try:
        held_since = (root / 'HOLD').stat().st_mtime
    except FileNotFoundError:
        return False
    if job['created'] > held_since:
        return False
    q.update(job['id'], status='queued', deadline=None, detail='Waiting for HOLD to clear.')
    return True


def run_job(q, job, root, lock_fd):
    key = job.get('resume_key')
    if not key:
        raise ValueError('resume key required; job refused')
    if not live(root):
        q.update(job['id'], status='dry_run', detail='Would run; the Rack is in dry-run mode.')
        return
    if wait_for_later_hold(q, job, root):
        return
    if job['started'] is None:
        reason = start_refusal(root, job['action'], json.loads(job['params']))
        if reason:
            if wait_for_later_hold(q, job, root):
                return
            q.update(job['id'], status='refused', deadline=None, detail=reason)
            return
    if wait_for_later_hold(q, job, root):
        return
    if (root / 'HOLD').exists():
        if job['started'] is None:
            q.update(job['id'], status='refused', detail='Work is held; nothing started.')
        else:
            q.update(job['id'], detail='Waiting for HOLD to clear.')
        return
    args, extra = recipe_command(root, job['action'])
    spec_path = q.root / (job['id'] + '-command.json')
    spec = {'args': args, 'env': extra}
    if spec_path.exists() and json.loads(spec_path.read_text()) != spec:
        raise ValueError('recipe changed; refusing unsafe resume')
    if not spec_path.exists():
        atomic_json(spec_path, spec)
    p = Pieces(q, job['id'], key)
    env = dict(os.environ, **extra)
    env.update(RACK_JOB_ID=job['id'], RACK_RESUME_KEY=key, RACK_QUEUE_ROOT=str(q.root),
               RACK_RUN_STAMP=datetime.fromtimestamp(job['created']).strftime('%Y-%m-%d-%H%M'))
    env.pop('RACK_TOKEN', None)  # the API secret never reaches a worker
    q.update(job['id'], status='running', started=time.time(), deadline=None,
             detail='Waiting for worker startup.')
    env.update(RACK_PIECE_SECONDS=str(MAX_PIECE_SECONDS), RACK_STARTUP_SECONDS=str(STARTUP_SECONDS),
               RACK_LOCK_FD=str(lock_fd))
    args = [sys.executable, str(Path(__file__).with_name('rack_supervisor.py')), *args]
    with (p.directory / 'worker.log').open('ab') as log:
        child = subprocess.Popen(args, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True, pass_fds=(lock_fd,))
        try:
            while child.poll() is None:
                # Controls are serviced while a job runs; a running job never suppresses a stop.
                for pending in q.jobs():
                    if pending['status'] == 'queued' and pending['action'] in CONTROL_ACTIONS:
                        process_job(q, pending, root, lock_fd)
                if (root / 'HOLD').exists() or not live(root):
                    terminate_child(child)
                    q.update(job['id'], status='queued', deadline=None,
                             detail='Paused safely; incomplete piece discarded, saved work retained.')
                    return
                time.sleep(0.2)
            if q.job(job['id'])['status'] in ('queued', 'blocked'):
                return  # The supervisor already recorded the precise timeout reason.
            if child.returncode == 75:
                initial = job['started'] is None
                q.update(job['id'], status='refused' if initial else 'queued', deadline=None,
                         detail='Admission refused the start; no automatic retry.' if initial
                         else 'Waiting for admission memory budget.')
            elif child.returncode == 0 and p.names() and len(p.saved()) == len(p.names()):
                q.update(job['id'], status='done', deadline=None, detail='Every piece durably saved.')
            else:
                q.update(job['id'], status='blocked', deadline=None,
                         detail=f'Worker exit {child.returncode}; incomplete work retained for review (worker.log).')
        finally:
            if child.poll() is None:
                terminate_child(child)


def process_job(q, job, root, lock_fd):
    try:
        if not job.get('resume_key'):
            raise ValueError('resume key required')
        validate_act(root, job['action'], json.loads(job['params']), job['who'])
        if job['action'] in CONTROL_ACTIONS:
            control(q, job, root)
        else:
            run_job(q, job, root, lock_fd)
    except Exception as exc:
        q.update(job['id'], status='blocked' if q.job(job['id'])['started'] else 'refused', deadline=None,
                 detail=f'Job stopped/refused: {type(exc).__name__}; last durable result retained.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='process the queue once and exit')
    opts = parser.parse_args()
    q = new_queue(ROOT)
    with actor_lock(ROOT) as lock_fd:
        for job in q.jobs():
            if job['status'] == 'running':
                q.update(job['id'], status='queued', deadline=None, detail='Actor restarted; resuming last durable piece.')
        while True:
            # Service controls before any queued recipe, preserving control order.
            for job in sorted(q.jobs(), key=lambda j: j['action'] not in CONTROL_ACTIONS):
                if job['status'] != 'queued':
                    continue
                process_job(q, job, ROOT, lock_fd)
            if opts.once:
                break
            time.sleep(2)


if __name__ == '__main__':
    main()
