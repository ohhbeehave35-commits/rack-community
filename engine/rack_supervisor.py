"""External deadline owner; survives actor death and a worker that holds the interpreter lock.

The actor creates our process group. We and the worker inherit actor.lock, so another
actor cannot admit work until the whole owned group has exited.
"""
import os
import signal
import subprocess
import sys
import time
from rack_jobs import JobQueue, Pieces


def supervise(args):
    q = JobQueue(os.environ['RACK_QUEUE_ROOT'])
    job_id = os.environ['RACK_JOB_ID']
    p = Pieces(q, job_id, os.environ['RACK_RESUME_KEY'])
    startup_limit = min(600, float(os.environ['RACK_STARTUP_SECONDS']))
    idle_since = time.monotonic()
    previous_save = max((r['saved_at'] for r in p.saved()), default=0)
    lock_fd = int(os.environ['RACK_LOCK_FD'])
    child = subprocess.Popen(args, pass_fds=(lock_fd,))
    try:
        while child.poll() is None:
            row = q.job(job_id)
            latest = max((r['saved_at'] for r in p.saved()), default=0)
            if latest != previous_save or row['deadline'] is not None:
                idle_since = time.monotonic()
                previous_save = latest
            deadline = row['deadline']
            expired_piece = deadline is not None and time.time() >= deadline
            expired_startup = deadline is None and time.monotonic() - idle_since >= startup_limit
            if expired_piece or expired_startup:
                # Serialize with begin/save's row updates. A newly armed piece
                # or a completed save invalidates the deadline we observed.
                with q.connect() as db:
                    db.execute('BEGIN IMMEDIATE')
                    current = db.execute('SELECT deadline FROM jobs WHERE id=?', (job_id,)).fetchone()[0]
                    if current != deadline:
                        continue
                    db.execute('UPDATE jobs SET status=?,deadline=NULL,detail=? WHERE id=?', (
                        'blocked' if expired_piece else 'queued',
                        'Piece exceeded its time limit; last durable result retained. Waiting for review.'
                        if expired_piece else 'Waiting to retry startup; startup timeout, saved work retained.', job_id))
                # Includes admitted descendants; no process-name matching. The
                # supervisor kills itself too, releasing the inherited lock.
                os.killpg(os.getpgrp(), signal.SIGKILL)
            time.sleep(.05)
        return child.returncode
    finally:
        if child.poll() is None:
            os.killpg(os.getpgrp(), signal.SIGKILL)


if __name__ == '__main__':
    raise SystemExit(supervise(sys.argv[1:]))
