import test from "node:test";
import assert from "node:assert/strict";

import { PowerLeaseManager } from "../extension/power.js";

test("power lease is held once across overlapping native jobs", async () => {
  const calls = [];
  const manager = new PowerLeaseManager({
    hasPermission: async () => true,
    requestKeepAwake: (level) => calls.push(`request:${level}`),
    releaseKeepAwake: () => calls.push("release")
  });

  await manager.acquire("first");
  await manager.acquire("second");
  await manager.release("first");
  assert.deepEqual(calls, ["request:system"]);
  await manager.release("second");
  assert.deepEqual(calls, ["request:system", "release"]);
});

test("denied power permission does not block the job", async () => {
  const calls = [];
  const manager = new PowerLeaseManager({
    hasPermission: async () => false,
    requestKeepAwake: () => calls.push("request"),
    releaseKeepAwake: () => calls.push("release")
  });

  assert.equal(await manager.acquire("job"), false);
  await manager.release("job");
  assert.deepEqual(calls, []);
});
