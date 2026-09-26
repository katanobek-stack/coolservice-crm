const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  SERVICE_CONTROLLER_COMMANDS,
  isAllowedServiceControllerCommand,
  parseServiceCommandResult,
  parseServiceHeartbeat,
  parseServiceLogMessage,
  parseServiceStatus,
} = require("../lib/serviceMonitor");

function heartbeat(overrides = {}) {
  return {
    controllerId: "service-esp32-001",
    heartbeatId: "boot-a:000001",
    reportedAt: "2026-09-27T02:00:00Z",
    ip: "10.0.0.24",
    simSignal: 21,
    modemState: "ready",
    gprsConnected: true,
    firmwareVersion: "1.4.0",
    uptimeSeconds: 3600,
    freeHeapBytes: 120000,
    flashBytes: 4194304,
    psramBytes: 0,
    resetReason: "power_on",
    uartConnected: true,
    logs: [{ level: "INFO", message: "GPRS connected", reportedAt: "2026-09-27T02:00:00Z" }],
    ...overrides,
  };
}

describe("service monitor contract", () => {
  test("accepts a bounded heartbeat and makes a deterministic log id", () => {
    const parsed = parseServiceHeartbeat(heartbeat());
    assert.equal(parsed.controllerId, "service-esp32-001");
    assert.equal(parsed.simSignal, 21);
    assert.equal(parsed.logs[0].id, "boot-a:000001:0");
  });

  test("rejects unexpected fields and invalid log levels", () => {
    assert.throws(() => parseServiceHeartbeat(heartbeat({ arbitraryAtCommand: "AT+RST" })));
    assert.throws(() => parseServiceHeartbeat(heartbeat({ logs: [{ level: "DEBUG", message: "x" }] })));
  });

  test("permits only the three safe queued commands", () => {
    assert.deepEqual(SERVICE_CONTROLLER_COMMANDS, ["SERVICE PING", "SERVICE STATUS", "SERVICE INFO"]);
    assert.equal(isAllowedServiceControllerCommand("SERVICE STATUS"), true);
    assert.equal(isAllowedServiceControllerCommand("AT+RST"), false);
    assert.equal(isAllowedServiceControllerCommand("GPIO0 LOW"), false);
  });

  test("accepts only bounded MQTT log, retained status and command-result contracts", () => {
    const log = parseServiceLogMessage({
      controllerId: "service-esp32-001", logId: "boot-a:log-1",
      reportedAt: "2026-09-27T02:00:00Z", level: "WARN", message: "GPRS retry",
    });
    assert.equal(log.level, "WARN");
    const status = parseServiceStatus({
      controllerId: "service-esp32-001", statusId: "boot-a:online",
      reportedAt: "2026-09-27T02:00:00Z", state: "online",
    });
    assert.equal(status.state, "online");
    const result = parseServiceCommandResult({
      controllerId: "service-esp32-001", commandId: "command-001",
      reportedAt: "2026-09-27T02:00:00Z", result: "ok", message: "pong",
    });
    assert.equal(result.result, "ok");
    assert.throws(() => parseServiceStatus({
      controllerId: "service-esp32-001", statusId: "invalid state",
      reportedAt: "2026-09-27T02:00:00Z", state: "unknown",
    }));
    assert.throws(() => parseServiceCommandResult({
      controllerId: "service-esp32-001", commandId: "command-001",
      reportedAt: "2026-09-27T02:00:00Z", result: "ok", message: "AT+RST",
      arbitraryAtCommand: "AT+RST",
    }));
  });
});
