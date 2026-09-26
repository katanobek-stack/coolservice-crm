import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isServiceControllerOnline,
  SERVICE_MONITOR_OFFLINE_MINUTES,
} from "../src/shared/serviceMonitorStatus";

describe("service monitor connection state", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");

  test("marks a registered controller online only while its heartbeat is fresh", () => {
    assert.equal(
      isServiceControllerOnline(true, new Date(now - SERVICE_MONITOR_OFFLINE_MINUTES * 60_000), now),
      true,
    );
    assert.equal(
      isServiceControllerOnline(true, new Date(now - SERVICE_MONITOR_OFFLINE_MINUTES * 60_000 - 1), now),
      false,
    );
  });

  test("does not show disabled or never-contacted controllers as online", () => {
    assert.equal(isServiceControllerOnline(false, new Date(now), now), false);
    assert.equal(isServiceControllerOnline(true, null, now), false);
  });

  test("uses a retained MQTT offline state immediately, even before heartbeat expiry", () => {
    assert.equal(
      isServiceControllerOnline(true, new Date(now), now, "offline", new Date(now)),
      false,
    );
    assert.equal(
      isServiceControllerOnline(true, new Date(now - 1_000), now, "online", new Date(now)),
      true,
    );
  });
});
