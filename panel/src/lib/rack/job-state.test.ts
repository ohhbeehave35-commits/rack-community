import test from 'node:test';
import assert from 'node:assert/strict';
import { holdBanner, jobLabel, jobWarning } from './job-state.ts';

test('queued and blocked jobs show waiting and never a red stall or memory warning', () => {
  for (const status of ['queued', 'blocked', 'done', 'refused', 'dry_run']) {
    assert.equal(jobWarning({ status, stalled: true, memory_high: true }), false);
  }
  assert.equal(jobLabel('queued'), 'waiting');
  assert.equal(jobLabel('blocked'), 'waiting');
  assert.equal(jobLabel('dry_run'), 'dry run');
});

test('only running jobs raise deadline and memory warnings', () => {
  assert.equal(jobWarning({ status: 'running', stalled: true, memory_high: false }), true);
  assert.equal(jobWarning({ status: 'running', stalled: false, memory_high: true }), true);
  assert.equal(jobWarning({ status: 'running', stalled: false, memory_high: false }), false);
});

test('the pause banner names who, when and why, and is absent when nothing is paused', () => {
  assert.equal(holdBanner({ present: false, who: null, at: null, reason: null }), null);
  assert.equal(holdBanner({ present: true, who: 'ann', at: '10:00', reason: 'Taking a break' }), 'Paused by ann at 10:00: Taking a break');
  assert.equal(holdBanner({ present: true, who: null, at: null, reason: null }), 'Paused by unknown at unknown: No reason recorded');
});
