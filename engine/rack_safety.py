"""Shared safety: what may be requested, and what must be refused before anything is queued.

The actual workers still start through admit.sh --run, so a start that passes here can still be told to wait.
"""
import json
import os
from pathlib import Path
import re
import subprocess
from rack_recipes import ADMIT, availability, load

HELD = 'Work is held; nothing queued or started.'
CONTROL_ACTIONS = ('pause', 'resume', 'stop', 'retry_job')
REASON = re.compile(r'^[^\n\r|$`]{0,200}$')
JOB_ID = re.compile(r'^[0-9a-f]{32}$')
WHO = re.compile(r'^[A-Za-z0-9._-]{1,40}$')


def validate_act(root, action, params, requested_by):
    """Raise ValueError (plain words) unless this is a known action with exactly the parameters it takes."""
    if not isinstance(params, dict):
        raise ValueError('params must be an object')
    if not WHO.match(str(requested_by)):
        raise ValueError('requested_by is 1-40 letters, digits, dots, dashes or underscores')
    if action in ('pause', 'stop'):
        if set(params) - {'reason'} or not REASON.match(str(params.get('reason', ''))):
            raise ValueError('%s takes only an optional reason of at most 200 characters, no line breaks, | $ or backticks' % action)
    elif action == 'resume':
        if params:
            raise ValueError('resume takes no parameters')
    elif action == 'retry_job':
        if set(params) != {'job_id'} or not JOB_ID.match(str(params['job_id'])):
            raise ValueError('retry_job takes only job_id')
    elif action in load(root):
        if params:
            raise ValueError('%s takes no parameters; the recipe fixes them' % action)
    else:
        raise ValueError('unknown action')


def start_refusal(root, action, params):
    """A plain-words reason a start must be refused right now, or None when it may be queued."""
    root = Path(root)
    if action == 'retry_job':
        from rack_jobs import JobQueue
        job = JobQueue(root / 'jobs').job(params['job_id'])
        return start_refusal(root, job['action'], json.loads(job['params']))
    if action not in load(root):
        return None
    info = availability(root, action)
    if not info['available']:
        return info['reason']
    if (root / 'HOLD').exists():
        return HELD
    env = dict(os.environ, ADMIT_PREVIEW='1', PYTHONDONTWRITEBYTECODE='1', RACK_DIR=str(root))
    env.pop('RACK_TOKEN', None)
    try:
        result = subprocess.run(['bash', ADMIT, info['admission'], str(info['peak_gb'])],
                                cwd=root, env=env, capture_output=True, timeout=15)
        if result.returncode != 0:
            return 'Admission refused the start (not enough memory budget); nothing queued or started.'
    except Exception:
        return 'Admission unavailable; nothing queued or started.'
    # Recheck after the preview.
    return HELD if (root / 'HOLD').exists() else None
