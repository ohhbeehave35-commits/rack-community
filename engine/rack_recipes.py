"""Recipes: fixed, reviewed ways to start work. A start names a recipe, never a command line.

Recipes live as JSON files in <rack dir>/recipes/*.json:
  {"action": "hello", "label": "Say hello in three pieces", "script": "samples/hello_pieces.py",
   "args": [], "admission": "hello", "peak_gb": 1}
A recipe whose script is missing is listed as unavailable with the reason; it is never guessed.
"""
import json
from pathlib import Path
import re
import sys

NAME = re.compile(r'^[a-z][a-z0-9_]{1,40}$')
ADMIT = str(Path(__file__).with_name('admit.sh'))
ENGINE_DIR = str(Path(__file__).resolve().parent)


def load(root):
    """All valid recipes under <root>/recipes, keyed by action name. Bad files are skipped, not trusted."""
    found = {}
    for path in sorted((Path(root) / 'recipes').glob('*.json')):
        try:
            r = json.loads(path.read_text(encoding='utf-8'))
            if not (isinstance(r, dict) and NAME.match(str(r.get('action', '')))):
                continue
            if not isinstance(r.get('script'), str) or '..' in r['script'] or r['script'].startswith('/'):
                continue
            if not isinstance(r.get('peak_gb'), int) or r['peak_gb'] < 0:
                continue
            args = r.get('args', [])
            if not (isinstance(args, list) and all(isinstance(a, str) for a in args)):
                continue
            found[r['action']] = {'action': r['action'], 'label': str(r.get('label', r['action']))[:120],
                                  'script': r['script'], 'args': args,
                                  'admission': str(r.get('admission') or r['action']), 'peak_gb': r['peak_gb']}
        except (OSError, ValueError):
            continue
    return found


def availability(root, action):
    r = load(root)[action]
    exists = (Path(root) / r['script']).is_file()
    return {'action': action, 'label': r['label'], 'available': exists,
            'reason': None if exists else 'The reviewed runner script is not installed.',
            'admission': r['admission'], 'peak_gb': r['peak_gb']}


def command(root, action):
    info = availability(root, action)
    if not info['available']:
        raise ValueError(info['reason'])
    r = load(root)[action]
    return ['bash', ADMIT, '--run', r['admission'], str(r['peak_gb']), '--', sys.executable,
            r['script'], *r['args']], {'RACK_DIR': str(root), 'PYTHONPATH': ENGINE_DIR}
