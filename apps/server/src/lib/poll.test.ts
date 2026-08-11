import { test } from "node:test";
import assert from "node:assert/strict";
import { pollUntilDone } from "./poll.js";

const noWait = async () => {};

test("returns the value once check() reports done", async () => {
  let calls = 0;
  const value = await pollUntilDone(
    async () => {
      calls++;
      return calls < 3 ? { done: false } : { done: true, value: "result" };
    },
    { sleep: noWait },
  );
  assert.equal(value, "result");
  assert.equal(calls, 3);
});

test("throws with the failure message once check() reports failed, without waiting further", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      pollUntilDone(
        async () => {
          calls++;
          return { done: true, failed: true, errorMessage: "task exploded" };
        },
        { sleep: noWait },
      ),
    /task exploded/,
  );
  assert.equal(calls, 1);
});

test("backs off using the provided schedule, capping at the last interval once exhausted", async () => {
  const waits: number[] = [];
  let calls = 0;
  await pollUntilDone(
    async () => {
      calls++;
      return calls <= 4 ? { done: false } : { done: true, value: "ok" };
    },
    {
      intervalsMs: [10, 20],
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.deepEqual(waits, [10, 20, 20, 20]);
});

test("throws a timeout error once maxAttempts is exhausted - never hangs", async () => {
  await assert.rejects(
    () => pollUntilDone(async () => ({ done: false }), { maxAttempts: 3, intervalsMs: [1], sleep: noWait }),
    /timed out/i,
  );
});
