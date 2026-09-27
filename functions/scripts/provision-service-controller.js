#!/usr/bin/env node
/*
 * One-time, explicitly scoped provisioning for the Service Monitor.
 * It never overwrites an existing controller or credential document.
 */
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { createDeviceCredentialHash } = require("../lib/telemetryKey");

const CONTROLLER_ID = "service-001";
const PROJECT_ID = "coolservice-crm";
const REPO_ROOT = path.resolve(__dirname, "../..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireOption(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(name + " is required");
  return value;
}

const projectId = requireOption("--project");
const execute = process.argv.includes("--execute");
const showCredential = process.argv.includes("--show-credential");
const outputPath = option("--credential-output");

if (projectId !== PROJECT_ID) throw new Error("only --project " + PROJECT_ID + " is permitted");
if (!execute || option("--confirm-controller") !== CONTROLLER_ID) {
  throw new Error("--execute requires --confirm-controller " + CONTROLLER_ID);
}

function safeCredentialOutputPath() {
  if (!outputPath) throw new Error("--credential-output is required when no credential exists");
  if (!path.isAbsolute(outputPath)) throw new Error("--credential-output must be outside the repository");
  const resolved = path.resolve(outputPath);
  const relativeToRepo = path.relative(REPO_ROOT, resolved);
  if (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo)) {
    throw new Error("--credential-output must be outside the repository");
  }
  return resolved;
}

if (!getApps().length) initializeApp({ projectId });
const firestore = getFirestore();
const controllerRef = firestore.doc("serviceControllers/" + CONTROLLER_ID);
const credentialRef = firestore.doc("monitoringDeviceCredentials/" + CONTROLLER_ID);
function writeCredentialOnce(resolvedOutputPath, deviceKey) {
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolvedOutputPath, deviceKey + "\n", {
    encoding: "utf8", mode: 0o600, flag: "wx",
  });
}

async function main() {
  // service-001 is separate from telemetry device-001. It gets its own
  // revocable hash and never rotates the telemetry controller credential.
  const [existingController, existingCredential] = await firestore.getAll(controllerRef, credentialRef);
  if (existingController.exists) throw new Error("service controller already exists; refusing to overwrite");

  let deviceKey = null;
  let credentialDocument = null;
  let resolvedOutputPath = null;
  if (!existingCredential.exists) {
    resolvedOutputPath = safeCredentialOutputPath();
    if (fs.existsSync(resolvedOutputPath)) throw new Error("credential output file already exists");
    deviceKey = randomBytes(32).toString("base64url");
    credentialDocument = {
      active: true,
      ...createDeviceCredentialHash(CONTROLLER_ID, deviceKey),
    };
    writeCredentialOnce(resolvedOutputPath, deviceKey);
  } else if (showCredential) {
    throw new Error("a credential already exists and will not be revealed or rotated");
  }

  try {
    await firestore.runTransaction(async (transaction) => {
      const [controller, credential] = await Promise.all([
        transaction.get(controllerRef),
        transaction.get(credentialRef),
      ]);
      if (controller.exists || (credential.exists !== existingCredential.exists)) {
        throw new Error("controller or credential changed during provisioning; refusing to overwrite");
      }
      const now = Timestamp.now();
      transaction.create(controllerRef, {
        enabled: true,
        displayName: "Service Controller 001",
        name: "Service Controller 001",
        objectName: "Test Object",
        deviceId: CONTROLLER_ID,
        createdAt: now,
        updatedAt: now,
      });
      if (credentialDocument) transaction.create(credentialRef, credentialDocument);
    });
  } catch (error) {
    if (resolvedOutputPath) fs.rmSync(resolvedOutputPath, { force: true });
    throw error;
  }

  console.error("Service controller " + CONTROLLER_ID + " was created.");
  if (resolvedOutputPath && deviceKey) {
    console.error("Credential hash was created; raw credential was written once to " + resolvedOutputPath + ".");
  } else {
    console.error("Existing telemetry credential hash was preserved; no raw credential was created or displayed.");
  }
  if (showCredential && deviceKey) {
    // Deliberate operator-only escape hatch. Do not use in CI, chat or logs.
    process.stdout.write(deviceKey + "\n");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
