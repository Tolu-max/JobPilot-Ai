import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPaused,
  setPaused,
  registerRunner,
  hasRunner,
  requestRun,
  _resetBotControl
} from '../src/botControl.js';

test.beforeEach(() => _resetBotControl());

test('pause state toggles', () => {
  assert.equal(isPaused(), false);
  setPaused(true);
  assert.equal(isPaused(), true);
  setPaused(false);
  assert.equal(isPaused(), false);
});

test('requestRun fails when no runner is registered', async () => {
  assert.equal(hasRunner(), false);
  const result = await requestRun();
  assert.deepEqual(result, { ok: false, reason: 'no_runner' });
});

test('requestRun invokes the registered runner and returns its result', async () => {
  let calls = 0;
  registerRunner(async () => {
    calls++;
    return { skipped: false };
  });
  assert.equal(hasRunner(), true);

  const result = await requestRun();
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { skipped: false });
});

test('requestRun guards against an in-flight run', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let starts = 0;
  registerRunner(async () => {
    starts++;
    await gate;
    return { skipped: false };
  });

  const first = requestRun();
  const second = await requestRun(); // runs while first is still awaiting the gate
  assert.deepEqual(second, { ok: false, reason: 'busy' });

  release();
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
  assert.equal(starts, 1);
});
