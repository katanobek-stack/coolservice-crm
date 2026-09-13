import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const DEVICE_KEY_ALGORITHM = "scrypt-v1";

const SALT_BYTES = 16;
const HASH_BYTES = 32;

export interface DeviceCredentialHash {
  algorithm: typeof DEVICE_KEY_ALGORITHM;
  keySalt: string;
  keyHash: string;
}

function deriveDeviceKey(deviceId: string, deviceKey: string, salt: Buffer): Buffer {
  return scryptSync(`${deviceId}:${deviceKey}`, salt, HASH_BYTES);
}

export function createDeviceCredentialHash(
  deviceId: string,
  deviceKey: string,
  salt = randomBytes(SALT_BYTES),
): DeviceCredentialHash {
  return {
    algorithm: DEVICE_KEY_ALGORITHM,
    keySalt: salt.toString("base64url"),
    keyHash: deriveDeviceKey(deviceId, deviceKey, salt).toString("base64url"),
  };
}

export function verifyDeviceKey(
  deviceId: string,
  deviceKey: string,
  credential: Record<string, unknown>,
): boolean {
  if (
    credential.algorithm !== DEVICE_KEY_ALGORITHM
    || typeof credential.keySalt !== "string"
    || typeof credential.keyHash !== "string"
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(credential.keyHash, "base64url");
    const actual = deriveDeviceKey(
      deviceId,
      deviceKey,
      Buffer.from(credential.keySalt, "base64url"),
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
