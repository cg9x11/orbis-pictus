import { test } from "node:test";
import assert from "node:assert/strict";
import { InFlight } from "./coalesce.js";

test("concurrent calls with the same key share a single execution", async () => {
  const inFlight = new InFlight<number>();
  let runs = 0;
  let release!: (v: number) => void;
  const gate = new Promise<number>((resolve) => {
    release = resolve;
  });
  const work = () => {
    runs += 1;
    return gate;
  };

  const a = inFlight.run("k", work);
  const b = inFlight.run("k", work);
  assert.equal(inFlight.size, 1);

  release(42);
  assert.equal(await a, 42);
  assert.equal(await b, 42);
  assert.equal(runs, 1); // work() ran once, not twice
  assert.equal(inFlight.size, 0); // entry cleared after settling
});

test("different keys run independently", async () => {
  const inFlight = new InFlight<string>();
  let runs = 0;
  const work = (value: string) => async () => {
    runs += 1;
    return value;
  };

  const [a, b] = await Promise.all([inFlight.run("a", work("a")), inFlight.run("b", work("b"))]);
  assert.equal(a, "a");
  assert.equal(b, "b");
  assert.equal(runs, 2);
});

test("a later call with the same key re-runs once the first has settled", async () => {
  const inFlight = new InFlight<number>();
  let runs = 0;
  const work = () => {
    runs += 1;
    return Promise.resolve(runs);
  };

  assert.equal(await inFlight.run("k", work), 1);
  // First call settled and was evicted, so this is not coalesced with it.
  assert.equal(await inFlight.run("k", work), 2);
  assert.equal(runs, 2);
});

test("a rejected in-flight call is evicted so the key can be retried", async () => {
  const inFlight = new InFlight<number>();
  let runs = 0;
  const failing = () => {
    runs += 1;
    return Promise.reject(new Error("boom"));
  };

  await assert.rejects(() => inFlight.run("k", failing), /boom/);
  assert.equal(inFlight.size, 0);
  // The failure did not poison the key: a fresh call runs again.
  const ok = () => Promise.resolve(7);
  assert.equal(await inFlight.run("k", ok), 7);
  assert.equal(runs, 1);
});
