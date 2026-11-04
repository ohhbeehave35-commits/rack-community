import json
import time

import pytest

from rack_jobs import DuplicateRequest, JobQueue, Pieces, atomic_json


def test_submit_and_list(tmp_path):
    q = JobQueue(tmp_path)
    job = q.submit('hello', {}, 'ann', 'key-1')
    rows = q.jobs()
    assert [r['id'] for r in rows] == [job]
    assert rows[0]['status'] == 'queued' and rows[0]['who'] == 'ann'


def test_same_request_within_a_minute_is_refused(tmp_path):
    q = JobQueue(tmp_path)
    q.submit('hello', {'a': 1}, 'ann', 'key-1')
    with pytest.raises(DuplicateRequest):
        q.submit('hello', {'a': 1}, 'ann', 'key-2')
    q.submit('hello', {'a': 2}, 'ann', 'key-3')  # different parameters are a different request


def test_unique_action_refuses_a_second_active_copy_after_a_minute(tmp_path):
    q = JobQueue(tmp_path, unique_actions=['hello'])
    t = time.time()
    q.submit('hello', {}, 'ann', 'key-1', now=t - 120)
    with pytest.raises(DuplicateRequest):
        q.submit('hello', {}, 'ann', 'key-2', now=t)


def test_resume_key_must_be_valid_and_unused(tmp_path):
    q = JobQueue(tmp_path)
    with pytest.raises(ValueError):
        q.submit('hello', {}, 'ann', 'bad key!')
    q.submit('hello', {'x': 1}, 'ann', 'same')
    with pytest.raises(ValueError):
        q.submit('hello', {'x': 2}, 'ann', 'same')


def test_pieces_save_in_order_and_resume(tmp_path):
    q = JobQueue(tmp_path)
    job = q.submit('hello', {}, 'ann', 'key-1')
    p = Pieces(q, job, 'key-1')
    p.plan(['a', 'b', 'c'])
    assert p.run('a', lambda: 1) == 1
    with pytest.raises(ValueError):
        p.save('c', 3)  # 'b' is not durable yet
    # A second worker object sees the saved piece and does not run it again.
    p2 = Pieces(q, job, 'key-1')
    assert p2.run('a', lambda: 'would run again') == 1
    assert [r['name'] for r in p2.saved()] == ['a']


def test_changed_plan_is_refused(tmp_path):
    q = JobQueue(tmp_path)
    job = q.submit('hello', {}, 'ann', 'key-1')
    p = Pieces(q, job, 'key-1')
    p.plan(['a', 'b'])
    with pytest.raises(ValueError):
        Pieces(q, job, 'key-1').plan(['a', 'c'])


def test_wrong_resume_key_is_refused(tmp_path):
    q = JobQueue(tmp_path)
    job = q.submit('hello', {}, 'ann', 'key-1')
    with pytest.raises(ValueError):
        Pieces(q, job, 'other-key')


def test_deadline_is_armed_once_and_cleared_by_a_save(tmp_path):
    q = JobQueue(tmp_path)
    job = q.submit('hello', {}, 'ann', 'key-1')
    p = Pieces(q, job, 'key-1')
    p.plan(['a'])
    p.begin('a')
    first = q.job(job)['deadline']
    assert first is not None
    time.sleep(0.01)
    p.begin('a')
    assert q.job(job)['deadline'] == first  # re-entering never extends the clock
    p.save('a', 'done')
    assert q.job(job)['deadline'] is None


def test_slivers_report_stall_and_memory(tmp_path):
    q = JobQueue(tmp_path)
    job = q.submit('hello', {}, 'ann', 'key-1')
    p = Pieces(q, job, 'key-1')
    p.plan(['a', 'b'])
    p.run('a', lambda: 1)
    q.update(job, status='running', deadline=100.0)
    row = q.slivers(now=200.0, memory_gb=95, memory_warn_gb=90)[0]
    assert row['piece'] == 1 and row['total'] == 2
    assert row['stalled'] is True and row['memory_high'] is True
    row = q.slivers(now=50.0, memory_gb=10, memory_warn_gb=90)[0]
    assert row['stalled'] is False and row['memory_high'] is False


def test_atomic_json_leaves_no_temp_file(tmp_path):
    atomic_json(tmp_path / 'x' / 'v.json', {'a': 1})
    assert json.loads((tmp_path / 'x' / 'v.json').read_text()) == {'a': 1}
    assert [p.name for p in (tmp_path / 'x').iterdir()] == ['v.json']
