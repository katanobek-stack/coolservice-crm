const { randomBytes } = require("node:crypto");
const { createDeviceCredentialHash } = require("../lib/telemetryKey");

const deviceId = process.argv[2];
if (!deviceId || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(deviceId)) {
  console.error("Usage: npm run generate:device-key -- device-001");
  process.exitCode = 1;
} else {
  const deviceKey = randomBytes(32).toString("base64url");
  console.error("Store deviceKey securely: it is shown once and is not written to disk.");
  console.log(JSON.stringify({
    deviceId,
    deviceKey,
    credentialDocument: {
      active: true,
      ...createDeviceCredentialHash(deviceId, deviceKey),
    },
  }, null, 2));
}
