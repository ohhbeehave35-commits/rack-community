import test from 'node:test';
import assert from 'node:assert/strict';
import { areaPoints, arcPath, pushHistory, readingLabel, readingValue } from './system.ts';

test('unavailable never becomes a zero and an outage hides old numbers', () => {
  assert.equal(readingLabel(undefined, false, '%'), 'unavailable');
  assert.equal(readingLabel({ value: null, last_read_at: 10 }, false, '%'), 'unavailable');
  assert.equal(readingLabel({ value: 42, last_read_at: 10 }, true, '%'), 'unavailable');
  assert.equal(readingLabel({ value: 0, last_read_at: 10 }, false, '%'), '0.0%');
  assert.equal(readingValue({ value: NaN, last_read_at: 10 }, false), null);
});

test('history keeps only real readings and the newest 60', () => {
  assert.deepEqual(pushHistory([1], null), [1]);
  assert.deepEqual(pushHistory([1], 2), [1, 2]);
  assert.equal(pushHistory(Array.from({ length: 60 }, (_, i) => i), 99).length, 60);
});

test('arc and area shapes are empty when there is nothing real to draw', () => {
  assert.equal(arcPath(50, 50, 40, 0), '');
  assert.match(arcPath(50, 50, 40, 1), /^M 10 50 A 40 40 0 0 1 90\.00 50\.00$/);
  assert.equal(areaPoints([5], 100, 100, 30), '');
  assert.equal(areaPoints([0, 100], 100, 100, 30), '0,30 0.0,30.0 100.0,0.0 100,30');
});
