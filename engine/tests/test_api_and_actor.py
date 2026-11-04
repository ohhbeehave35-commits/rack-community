"""The API and the actor together, in a throwaway Rack folder: the first-run path from the README."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest
from fastapi.testclient import TestClient

ENGINE = Path(__file__).resolve().parents[1]
TOKEN = {'X-Rack-Token': 'test-token-not-a-real-value'}


@pytest.fixture
def client(rack, monkeypatch):
    import rack_api
    monkeypatch.setattr(rack_api, 'ROOT', rack)
    return TestClient(rack_api.app)


def actor_once(rack, **env):
    e = dict(os.environ, RACK_DIR=str(rack), **env)
    return subprocess.run([sys.executable, str(ENGINE / 'rack_actor.py'), '--once'], env=e,
                          capture_output=True, text=True, timeout=120, cwd=rack)


def jobs(client):
    return client.get('/slivers').json()['jobs']


def test_writes_and_locked_reads_need_the_token(client):
    assert client.post('/unlock', json={}).status_code == 401
    assert client.post('/unlock', json={}, headers={'X-Rack-Token': 'wrong'}).status_code == 401
    assert client.get('/status').status_code == 401
    assert client.get('/status/stream').status_code == 401
    assert client.post('/unlock', json={}, headers=TOKEN).json() == {'ok': True}
    assert client.get('/status', headers=TOKEN).status_code == 200
    assert client.get('/recipes').status_code == 200  # plain reads stay open


def test_no_token_configured_means_nothing_unlocks(client, monkeypatch):
    monkeypatch.delenv('RACK_TOKEN')
    assert client.post('/unlock', json={}, headers=TOKEN).status_code == 401


def test_recipes_and_preview(client):
    names = {r['action']: r for r in client.get('/recipes').json()['recipes']}
    assert set(names) == {'hello', 'slow_count', 'too_big'} and all(r['available'] for r in names.values())
    ok = client.post('/preview', json={'recipe': 'hello'}, headers=TOKEN).json()
    assert ok['admitted'] is True
    big = client.post('/preview', json={'recipe': 'too_big'}, headers=TOKEN).json()
    assert big['admitted'] is False and 'Admission refused' in big['verdict']
    assert client.post('/preview', json={'recipe': 'nope'}, headers=TOKEN).status_code == 400


def test_act_validates_and_refuses_what_admission_refuses(client, rack):
    for body in ({'action': 'rm_everything', 'params': {}},
                 {'action': 'hello', 'params': {'cmd': 'ls'}},
                 {'action': 'pause', 'params': {'reason': 'bad | pipe'}},
                 {'action': 'retry_job', 'params': {'job_id': 'zz'}}):
        assert client.post('/act', json=body, headers=TOKEN).status_code == 400, body
    refused = client.post('/act', json={'action': 'too_big', 'params': {}}, headers=TOKEN)
    assert refused.status_code == 409 and 'nothing queued' in refused.json()['detail']
    assert jobs(client) == []


def test_dry_run_records_but_changes_nothing(client, rack):
    r = client.post('/act', json={'action': 'hello', 'params': {}}, headers=TOKEN)
    assert r.status_code == 200 and r.json()['ok']
    actor_once(rack)
    row = jobs(client)[0]
    assert row['status'] == 'dry_run' and 'dry-run' in row['detail']
    assert client.get('/live').json()['live'] is False


def test_live_run_saves_every_piece_and_finishes(client, rack):
    assert client.post('/live', json={'live': True, 'who': 'tester'}, headers=TOKEN).json()['live'] is True
    client.post('/act', json={'action': 'hello', 'params': {}, 'requested_by': 'tester'}, headers=TOKEN)
    result = actor_once(rack)
    assert result.returncode == 0, result.stderr
    row = jobs(client)[0]
    assert row['status'] == 'done' and row['piece'] == 3 and row['total'] == 3
    assert 'ADMIT hello' in (rack / 'ADMISSIONS.md').read_text()
    assert [l for l in client.get('/actions').json()['rows'] if 'hello by tester' in l]


def test_pause_holds_new_starts_and_resume_releases(client, rack):
    client.post('/live', json={'live': True}, headers=TOKEN)
    client.post('/act', json={'action': 'pause', 'params': {'reason': 'Taking a break'}, 'requested_by': 'tester'}, headers=TOKEN)
    actor_once(rack)
    hold = json.loads((rack / 'HOLD').read_text())
    assert hold['who'] == 'tester' and hold['reason'] == 'Taking a break'
    assert 'Paused' in client.get('/activity').json()['sentence']
    held = client.post('/act', json={'action': 'hello', 'params': {}}, headers=TOKEN)
    assert held.status_code == 409 and 'held' in held.json()['detail']
    client.post('/act', json={'action': 'resume', 'params': {}, 'requested_by': 'tester'}, headers=TOKEN)
    actor_once(rack)
    assert not (rack / 'HOLD').exists()
    assert client.post('/act', json={'action': 'hello', 'params': {}}, headers=TOKEN).status_code == 200


def test_work_queued_before_a_pause_waits_and_then_runs(client, rack):
    client.post('/live', json={'live': True}, headers=TOKEN)
    client.post('/act', json={'action': 'hello', 'params': {}}, headers=TOKEN)
    time.sleep(0.05)
    (rack / 'HOLD').write_text(json.dumps({'who': 'tester', 'at': 'now', 'reason': 'x'}))
    actor_once(rack)
    row = jobs(client)[0]
    assert row['status'] == 'queued' and 'HOLD' in row['detail']
    (rack / 'HOLD').unlink()
    actor_once(rack)
    assert jobs(client)[0]['status'] == 'done'


def test_a_stopped_job_keeps_its_saved_pieces_and_resumes(client, rack):
    client.post('/live', json={'live': True}, headers=TOKEN)
    client.post('/act', json={'action': 'slow_count', 'params': {}}, headers=TOKEN)
    env = dict(os.environ, RACK_DIR=str(rack), RACK_SAMPLE_DELAY='1')
    actor = subprocess.Popen([sys.executable, str(ENGINE / 'rack_actor.py'), '--once'], env=env, cwd=rack,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 30
    while time.time() < deadline and (not jobs(client) or jobs(client)[0]['piece'] < 2):
        time.sleep(0.2)
    saved_before = jobs(client)[0]['piece']
    assert saved_before >= 2, 'the job should have saved at least two pieces'
    client.post('/act', json={'action': 'stop', 'params': {'reason': 'test stop'}, 'requested_by': 'tester'}, headers=TOKEN)
    actor.wait(timeout=60)
    row = jobs(client)[0]
    assert row['status'] == 'queued' and 'Paused safely' in row['detail']
    assert row['piece'] >= saved_before and row['piece'] < 5
    # Resume, run again: the saved pieces are not redone and the job finishes.
    client.post('/act', json={'action': 'resume', 'params': {}, 'requested_by': 'tester'}, headers=TOKEN)
    final = actor_once(rack, RACK_SAMPLE_DELAY='0.1')  # services the resume first; the queued job then runs
    assert final.returncode == 0
    assert jobs(client)[0]['status'] == 'done' and jobs(client)[0]['piece'] == 5


def test_status_stream_through_the_api(client, rack):
    (rack / 'STATUS').write_text('one\ntwo\nthree\n')
    got = client.get('/status/stream?limit=2', headers=TOKEN).json()
    assert [l['text'] for l in got['lines']] == ['two', 'three']
    assert client.get('/status/stream?limit=0', headers=TOKEN).status_code == 400
