// Shared, in-memory control surface for the scheduler run loop.
//
// The Telegram bot polls inside the scheduler process (see scheduler.js), so a
// plain module-level singleton is enough to carry control state between the bot
// (which receives /pause, /resume, /run) and the scheduler's run loop. No files
// or IPC required.

let paused = false;
let runner = null;
let runInFlight = false;

export function isPaused() {
  return paused;
}

export function setPaused(value) {
  paused = Boolean(value);
  return paused;
}

export function registerRunner(fn) {
  runner = typeof fn === 'function' ? fn : null;
}

export function hasRunner() {
  return Boolean(runner);
}

// Force a run now, regardless of pause state. Guards against overlapping manual
// runs; the scheduler's own `running` flag still guards against tick overlap.
export async function requestRun(options = {}) {
  if (!runner) return { ok: false, reason: 'no_runner' };
  if (runInFlight) return { ok: false, reason: 'busy' };

  runInFlight = true;
  try {
    const result = await runner(options);
    return { ok: true, result };
  } finally {
    runInFlight = false;
  }
}

// Test-only reset so module-level state does not leak between test cases.
export function _resetBotControl() {
  paused = false;
  runner = null;
  runInFlight = false;
}
