import os
from pathlib import Path
import subprocess
import sys
import pytest

pytestmark = pytest.mark.skipif(sys.platform != "linux", reason="Requires Linux flock, /proc and POSIX process groups; run on Linux or WSL2")

ADMIT = Path(__file__).resolve().parents[1] / 'admit.sh'


def run(rack, *args, **env):
    e = dict(os.environ, RACK_DIR=str(rack), ADMIT_LIMIT='90', ADMIT_BASE='10', **env)
    return subprocess.run(['bash', str(ADMIT), *args], env=e, capture_output=True, text=True, timeout=60)


def test_admits_when_the_budget_has_room(rack):
    r = run(rack, 'hello', ADMIT_USED_GB='5')
    assert r.returncode == 0
    assert 'ADMIT hello peak 1' in (rack / 'ADMISSIONS.md').read_text()


def test_waits_when_live_use_plus_peak_is_over_the_limit(rack):
    r = run(rack, 'hello', ADMIT_USED_GB='89')
    assert r.returncode == 0  # 89 + 1 = 90 <= 90
    r = run(rack, 'slow_count', ADMIT_USED_GB='89')
    assert r.returncode == 1  # 89 + 2 = 91 > 90
    assert 'WAIT' in (rack / 'ADMISSIONS.md').read_text()


def test_run_exits_75_on_wait_and_runs_the_command_on_admit(rack):
    waited = run(rack, '--run', 'too_big', '--', 'echo', 'should-not-run')
    assert waited.returncode == 75 and 'should-not-run' not in waited.stdout
    ran = run(rack, '--run', 'hello', '--', 'echo', 'ran-it')
    assert ran.returncode == 0 and 'ran-it' in ran.stdout


def test_peak_argument_overrides_and_unknown_job_needs_one(rack):
    assert run(rack, 'not_listed').returncode == 2
    assert run(rack, 'not_listed', '3').returncode == 0


def test_declared_peaks_of_live_jobs_count_against_the_budget(rack):
    (rack / 'ADMITTED.d').mkdir()
    holder = subprocess.Popen(['sleep', '30'])
    try:
        (rack / 'ADMITTED.d' / str(holder.pid)).write_text('big_one 78\n')
        # base 10 + 78 declared = 88; a 3 GB job would reach 91 > 90 even though live use is only 5.
        assert run(rack, 'unknown_small', '3', ADMIT_USED_GB='5').returncode == 1
        assert run(rack, 'unknown_small', '2', ADMIT_USED_GB='5').returncode == 0
    finally:
        holder.kill()
        holder.wait()
    # With the holder gone its entry is dropped and the same request is admitted.
    assert run(rack, 'unknown_small', '3', ADMIT_USED_GB='5').returncode == 0
    assert not (rack / 'ADMITTED.d' / str(holder.pid)).exists()


def test_preview_never_touches_the_real_ledger(rack):
    r = run(rack, 'hello', ADMIT_PREVIEW='1')
    assert r.returncode == 0
    assert not (rack / 'ADMISSIONS.md').exists()
    assert 'PREVIEW' in (rack / 'ADMISSIONS-PREVIEW.md').read_text()


def test_dry_table_lists_every_job(rack):
    out = run(rack, '--dry').stdout
    for name in ('hello', 'slow_count', 'too_big'):
        assert '| %s |' % name in out
