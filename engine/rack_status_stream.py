"""Stream a STATUS text file to the panel while a run goes.

Read-only. It reads <rack dir>/STATUS and nothing else, never writes, never starts anything. The caller keeps a
cursor (a byte offset this module hands back) and asks again for what is new. The first ask (since 0) returns only
the newest lines, never the whole file. A line that is still being written is held back until it is finished. If
the file got shorter (it was rotated) the answer says reset and starts again from the newest lines.
"""
import os
import re
from pathlib import Path

MAX_LIMIT = 200
MAX_BYTES = 65536
MAX_LINE = 500
FIRST_TAIL_BYTES = 16384
SAFE_MATCH = re.compile(r'^[A-Za-z0-9._:/ -]{0,60}$')
_CTRL = re.compile(r'[\x00-\x08\x0b-\x1f\x7f]')


def base_dir(default):
    """The folder whose STATUS file is streamed: RACK_STATUS_DIR when set, else the Rack's own folder."""
    return Path(os.environ.get('RACK_STATUS_DIR') or default)


def _clean(raw):
    text = _CTRL.sub('', raw.decode('utf-8', errors='replace')).rstrip('\r')
    return text[:MAX_LINE]


def check_args(since, limit, match):
    if type(since) is not int or since < 0:
        raise ValueError('since must be a whole number, 0 or more')
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ValueError('limit must be a whole number from 1 to %d' % MAX_LIMIT)
    if not isinstance(match, str) or not SAFE_MATCH.match(match):
        raise ValueError('match is at most 60 letters, digits, space or . _ : / -')


def read_stream(root, since=0, limit=100, match=''):
    check_args(since, limit, match)
    path = Path(root) / 'STATUS'
    try:
        size = path.stat().st_size
        f = open(path, 'rb')
    except OSError:
        return {'lines': [], 'cursor': 0, 'size': 0, 'reset': False}
    with f:
        reset = since > size
        if since == 0 or reset:
            start = max(0, size - FIRST_TAIL_BYTES)
            tail_mode = True
        else:
            start = since
            tail_mode = False
        # Begin on a line boundary: if we start mid-line, drop the broken first piece.
        seek = start - 1 if start > 0 else 0
        f.seek(seek)
        blob = f.read(MAX_BYTES + 1)
    base = seek
    if start > 0:
        if blob[:1] != b'\n':
            nl = blob.find(b'\n')
            if nl < 0:
                return {'lines': [], 'cursor': start if not tail_mode else size, 'size': size, 'reset': reset}
            blob, base = blob[nl + 1:], base + nl + 1
        else:
            blob, base = blob[1:], base + 1
    blob = blob[:MAX_BYTES]
    last_nl = blob.rfind(b'\n')
    if last_nl < 0:
        return {'lines': [], 'cursor': base, 'size': size, 'reset': reset}
    complete = blob[:last_nl + 1]
    rows, pos = [], 0
    for piece in complete.split(b'\n')[:-1]:
        at = base + pos
        pos += len(piece) + 1
        text = _clean(piece)
        if match and match not in text:
            rows.append(None)
            continue
        rows.append({'at': at, 'text': text, 'end': base + pos})
    kept = [r for r in rows if r]
    if tail_mode and len(kept) > limit:
        kept = kept[-limit:]
        cursor = base + len(complete)
    elif len(kept) > limit:
        kept = kept[:limit]
        cursor = kept[-1]['end']
    else:
        cursor = base + len(complete)
    return {'lines': [{'at': r['at'], 'text': r['text']} for r in kept], 'cursor': cursor, 'size': size, 'reset': reset}
