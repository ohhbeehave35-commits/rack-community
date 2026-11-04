import pytest

import rack_status_stream as s
from rack_system import SystemMonitor


def test_missing_file_is_empty(tmp_path):
    assert s.read_stream(tmp_path)['lines'] == []


def test_first_ask_returns_newest_and_cursor_follows(tmp_path):
    (tmp_path / 'STATUS').write_text(''.join('line %d\n' % i for i in range(300)))
    first = s.read_stream(tmp_path, 0, 5)
    assert [l['text'] for l in first['lines']] == ['line %d' % i for i in range(295, 300)]
    with open(tmp_path / 'STATUS', 'a') as f:
        f.write('line 300\nline 301\n')
    nxt = s.read_stream(tmp_path, first['cursor'], 10)
    assert [l['text'] for l in nxt['lines']] == ['line 300', 'line 301']


def test_a_line_still_being_written_is_held_back(tmp_path):
    (tmp_path / 'STATUS').write_text('done line\npartial')
    got = s.read_stream(tmp_path, 0, 10)
    assert [l['text'] for l in got['lines']] == ['done line']


def test_rotation_resets(tmp_path):
    (tmp_path / 'STATUS').write_text('a\nb\nc\n')
    cur = s.read_stream(tmp_path, 0, 10)['cursor']
    (tmp_path / 'STATUS').write_text('x\n')
    got = s.read_stream(tmp_path, cur, 10)
    assert got['reset'] is True and [l['text'] for l in got['lines']] == ['x']


def test_filter_and_bad_arguments(tmp_path):
    (tmp_path / 'STATUS').write_text('alpha 1\nbeta 2\nalpha 3\n')
    assert [l['text'] for l in s.read_stream(tmp_path, 0, 10, 'alpha')['lines']] == ['alpha 1', 'alpha 3']
    for bad in ((-1, 10, ''), (0, 0, ''), (0, 1000, ''), (0, 10, 'a;b')):
        with pytest.raises(ValueError):
            s.read_stream(tmp_path, *bad)


def test_control_characters_are_removed(tmp_path):
    (tmp_path / 'STATUS').write_bytes(b'ok\x1b[31m red\x00\n')
    assert s.read_stream(tmp_path, 0, 5)['lines'][0]['text'] == 'ok[31m red'


def test_system_monitor_reports_null_not_zero_when_unreadable():
    def no_read(path):
        raise OSError('not here')

    def no_gpu():
        raise OSError('no gpu')
    r = SystemMonitor(read=no_read, gpu=no_gpu).sample()
    assert r['cpu_percent']['value'] is None and r['gpu_percent']['value'] is None
    assert r['memory_used_gb']['value'] is None and r['memory_total_gb'] is None


def test_system_monitor_reads_memory_and_gpu():
    meminfo = 'MemTotal: 16777216 kB\nMemAvailable: 8388608 kB\n'
    stat = 'cpu  10 0 10 80 0 0 0 0\ncpu0 10 0 10 80 0 0 0 0\n'
    r = SystemMonitor(read=lambda p: stat if p.endswith('stat') else meminfo,
                      gpu=lambda: '37, 2048, 55, 120.5\n').sample()
    assert r['memory_total_gb'] == 16 and r['memory_source'] == 'gpu'
    assert r['memory_used_gb']['value'] == 2.0 and r['gpu_percent']['value'] == 37
