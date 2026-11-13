const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");

// Evaluate awaits the predicate's result before testing truthiness. Keep evaluations serial.
async function waitForAsync(pageOrFrame, fn, arg, { timeout = 30000, interval = 100 } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval < 0)
    throw new RangeError("waitForAsync requires timeout > 0 and interval >= 0");
  const deadline = performance.now() + timeout;
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`waitForAsync timed out after ${timeout}ms: ${fn}`)),
      timeout,
    );
  });
  try {
    for (;;) {
      const value = await Promise.race([pageOrFrame.evaluate(fn, arg), expired]);
      if (value) return value;
      await Promise.race([
        delay(Math.min(interval, Math.max(0, deadline - performance.now()))),
        expired,
      ]);
    }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { waitForAsync };
