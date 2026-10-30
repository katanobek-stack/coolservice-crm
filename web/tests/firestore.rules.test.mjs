import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "coolservice-crm-rules-test";
const RULES_PATH = new URL("../../firestore.rules", import.meta.url);

let testEnv;

function dbFor(uid, token = {}) {
  return testEnv.authenticatedContext(uid, token).firestore();
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

async function seedRole(uid, role, extra = {}) {
  await seed(`staff/${uid}`, {
    name: uid,
    email: `${uid}@example.test`,
    role,
    ...extra,
  });
}

async function seedAppointment(id, assignees = ["mechanic-1"]) {
  await seed(`appointments/${id}`, {
    assignees,
    assigneeNames: assignees.map((uid) => uid),
    status: "pending",
    createdBy: "manager-1",
    createdAt: "2026-08-28T00:00:00.000Z",
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: await readFile(RULES_PATH, "utf8") },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

describe("daily plans", () => {
  beforeEach(async () => {
    await seedRole("mechanic-1", "mechanic");
    await seedRole("mechanic-2", "mechanic");
    await seedRole("manager-1", "manager");
    await seed("dailyPlans/mechanic-1_2026-10-13", { staffId: "mechanic-1", date: "2026-10-13", status: "published" });
    await seed("dailyPlans/mechanic-1_2026-10-13/items/one", { title: "Published" });
    await seed("dailyPlans/mechanic-1_2026-10-13/draftItems/one", { title: "Draft" });
    await seed("dailyPlanNotifications/one", { planId: "mechanic-1_2026-10-13", status: "sent" });
  });
  test("workers read own published items and get a missing day without permission errors", async () => {
    const db = dbFor("mechanic-1");
    await assertSucceeds(getDoc(doc(db, "dailyPlans/mechanic-1_2026-10-13")));
    await assertSucceeds(getDoc(doc(db, "dailyPlans/mechanic-1_2026-10-14")));
    await assertSucceeds(getDocs(collection(db, "dailyPlans/mechanic-1_2026-10-13/items")));
    await assertFails(getDocs(collection(db, "dailyPlans/mechanic-1_2026-10-13/draftItems")));
    await assertFails(getDoc(doc(db, "dailyPlanNotifications/one")));
    await assertFails(getDoc(doc(dbFor("mechanic-2"), "dailyPlans/mechanic-1_2026-10-13")));
    await assertFails(getDoc(doc(dbFor("mechanic-2"), "dailyPlans/mechanic-1_2026-10-13/items/one")));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "dailyPlans/mechanic-1_2026-10-13")));
  });
  test("draft contents and every client-side write are protected", async () => {
    await seed("dailyPlans/mechanic-1_2026-10-13", { staffId: "mechanic-1", status: "draft" });
    await assertFails(getDoc(doc(dbFor("mechanic-1"), "dailyPlans/mechanic-1_2026-10-13/items/one")));
    const manager = dbFor("manager-1");
    await assertSucceeds(getDocs(collection(manager, "dailyPlans/mechanic-1_2026-10-13/draftItems")));
    await assertSucceeds(getDoc(doc(manager, "dailyPlanNotifications/one")));
    for (const uid of ["mechanic-1", "manager-1"]) {
      const db = dbFor(uid);
      await assertFails(updateDoc(doc(db, "dailyPlans/mechanic-1_2026-10-13"), { status: "published" }));
      await assertFails(setDoc(doc(db, "dailyPlans/mechanic-1_2026-10-13/items/two"), { title: "Forged" }));
      await assertFails(setDoc(doc(db, "dailyPlans/mechanic-1_2026-10-13/draftItems/two"), { title: "Forged" }));
      await assertFails(updateDoc(doc(db, "dailyPlanNotifications/one"), { status: "pending" }));
    }
  });
  test("assigned mechanics cannot change service assignment, title or another worker completion", async () => {
    await seed("servicetasks/joint", { title: "Work", assignees: ["mechanic-1", "mechanic-2"], doneBy: ["mechanic-2"], status: "in_progress" });
    const ref = doc(dbFor("mechanic-1"), "servicetasks/joint");
    await assertFails(updateDoc(ref, { assignees: ["mechanic-1"] }));
    await assertFails(updateDoc(ref, { title: "Changed" }));
    await assertFails(updateDoc(ref, { status: "done" }));
    await assertFails(updateDoc(ref, { doneBy: ["mechanic-1"] }));
    await assertSucceeds(updateDoc(ref, { doneBy: ["mechanic-2", "mechanic-1"], status: "done" }));
    await assertSucceeds(updateDoc(ref, { workComment: "Ready" }));
    await assertSucceeds(updateDoc(doc(dbFor("manager-1"), "servicetasks/joint"), { assignees: ["mechanic-1"] }));
  });
});

describe("unauthenticated", () => {
  test("cannot read or write protected data", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "clients/client-1")));
    await assertFails(setDoc(doc(db, "clients/client-1"), { name: "No auth" }));
    await assertFails(getDoc(doc(db, "staff/user-1")));
  });
});

describe("mechanic staff profile and escalation resistance", () => {
  test("can create only own mechanic profile", async () => {
    const db = dbFor("mechanic-1");
    await assertSucceeds(setDoc(doc(db, "staff/mechanic-1"), {
      name: "Mechanic",
      email: "mechanic@example.test",
      role: "mechanic",
    }));
    await assertFails(setDoc(doc(db, "staff/someone-else"), {
      name: "Other",
      role: "mechanic",
    }));
  });

  for (const role of ["admin", "manager", "owner"]) {
    test(`cannot create own profile as ${role}`, async () => {
      const db = dbFor(`new-${role}`);
      await assertFails(setDoc(doc(db, `staff/new-${role}`), {
        name: "Escalation",
        role,
      }));
    });
  }

  test("can update safe own fields and FCM fields", async () => {
    await seedRole("mechanic-1", "mechanic");
    const ref = doc(dbFor("mechanic-1"), "staff/mechanic-1");
    await assertSucceeds(updateDoc(ref, { name: "New name", email: "new@example.test" }));
    await assertSucceeds(setDoc(ref, {
      fcmTokens: ["token"],
      fcmUpdatedAt: "2026-08-28T00:00:00.000Z",
    }, { merge: true }));
  });

  test("cannot change role with updateDoc or merge", async () => {
    await seedRole("mechanic-1", "mechanic");
    const ref = doc(dbFor("mechanic-1"), "staff/mechanic-1");
    await assertFails(updateDoc(ref, { role: "manager" }));
    await assertFails(setDoc(ref, { role: "admin" }, { merge: true }));
  });

  test("cannot add permissions or combine a safe field with role", async () => {
    await seedRole("mechanic-1", "mechanic");
    const ref = doc(dbFor("mechanic-1"), "staff/mechanic-1");
    await assertFails(updateDoc(ref, { permissions: { pl_panel: true } }));
    await assertFails(updateDoc(ref, { name: "Looks safe", role: "admin" }));
    await assertFails(updateDoc(ref, {
      name: "Looks safe",
      permissions: { pl_panel: true },
    }));
  });

  test("cannot add unknown fields through update or merge", async () => {
    await seedRole("mechanic-1", "mechanic");
    const ref = doc(dbFor("mechanic-1"), "staff/mechanic-1");
    await assertFails(updateDoc(ref, { superuser: true }));
    await assertFails(setDoc(ref, { accessLevel: "admin" }, { merge: true }));
  });

  test("cannot edit another staff profile", async () => {
    await seedRole("mechanic-1", "mechanic");
    await seedRole("mechanic-2", "mechanic");
    await assertFails(updateDoc(doc(dbFor("mechanic-1"), "staff/mechanic-2"), {
      name: "Changed",
    }));
  });
});

describe("mechanic operational access", () => {
  beforeEach(async () => seedRole("mechanic-1", "mechanic"));

  test("can read/create/update clients but cannot delete them", async () => {
    const db = dbFor("mechanic-1");
    const ref = doc(db, "clients/client-1");
    await assertSucceeds(setDoc(ref, { name: "Voice-created client" }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { repairs: [] }));
    await assertFails(deleteDoc(ref));
  });

  test("can update assigned service tasks but cannot change others/create/delete", async () => {
    await seed("servicetasks/task-1", {
      title: "Task", status: "open", assignees: ["mechanic-1"],
    });
    await seed("servicetasks/task-2", {
      title: "Other task", status: "open", assignees: ["mechanic-2"],
    });
    const db = dbFor("mechanic-1");
    await assertSucceeds(updateDoc(doc(db, "servicetasks/task-1"), { status: "done", doneBy: ["mechanic-1"] }));
    await assertFails(updateDoc(doc(db, "servicetasks/task-2"), { status: "done" }));
    await assertFails(updateDoc(doc(db, "servicetasks/task-2"), {
      assignees: ["mechanic-1"],
      status: "done",
    }));
    await assertFails(addDoc(collection(db, "servicetasks"), { title: "New" }));
    await assertFails(deleteDoc(doc(db, "servicetasks/task-1")));
  });

  test("can create appointments and update only assigned appointments without assignee escalation", async () => {
    const createdAt = "2026-08-28T00:00:00.000Z";
    await seed("appointments/assigned", {
      assignees: ["mechanic-1"], assigneeNames: ["Mechanic"], status: "pending",
      createdBy: "manager-1", createdAt,
    });
    await seed("appointments/unassigned", {
      assignees: ["other"], assigneeNames: ["Other"], status: "pending",
      createdBy: "manager-1", createdAt,
    });
    const db = dbFor("mechanic-1");
    await assertSucceeds(addDoc(collection(db, "appointments"), {
      assignees: [], status: "pending",
    }));
    await assertSucceeds(updateDoc(doc(db, "appointments/assigned"), { status: "closed" }));
    await assertFails(updateDoc(doc(db, "appointments/assigned"), {
      assignees: ["mechanic-1", "other"],
      assigneeNames: ["Mechanic", "Other"],
    }));
    await assertFails(updateDoc(doc(db, "appointments/assigned"), { createdBy: "mechanic-1" }));
    await assertFails(updateDoc(doc(db, "appointments/unassigned"), { status: "closed" }));
    await assertFails(updateDoc(doc(db, "appointments/unassigned"), {
      assignees: ["mechanic-1"],
      status: "closed",
    }));
    await assertFails(deleteDoc(doc(db, "appointments/assigned")));
  });

  for (const [field, value] of [
    ["assignees", ["mechanic-1", "other"]],
    ["assigneeNames", ["Changed"]],
    ["createdBy", "mechanic-1"],
    ["createdAt", "2026-08-29T00:00:00.000Z"],
  ]) {
    test(`cannot change protected appointment field ${field}`, async () => {
      await seedAppointment(`protected-${field}`);
      await assertFails(updateDoc(doc(dbFor("mechanic-1"), `appointments/protected-${field}`), {
        [field]: value,
      }));
    });
  }

  test("cannot combine an allowed status change with an assignee change", async () => {
    await seedAppointment("mixed-update");
    await assertFails(updateDoc(doc(dbFor("mechanic-1"), "appointments/mixed-update"), {
      status: "closed",
      assignees: ["mechanic-1", "other"],
    }));
  });

  test("cannot remove another assignee from an assigned appointment", async () => {
    await seedAppointment("remove-assignee", ["mechanic-1", "mechanic-2"]);
    await assertFails(updateDoc(doc(dbFor("mechanic-1"), "appointments/remove-assignee"), {
      assignees: ["mechanic-1"],
      assigneeNames: ["mechanic-1"],
    }));
  });

  test("cannot mutate freezers, schedules, finance, or expenses", async () => {
    await seed("freezers/freezer-1", { name: "Freezer" });
    await seed("expenses/expense-1", { amount: 1 });
    const db = dbFor("mechanic-1");
    await assertFails(setDoc(doc(db, "freezers/freezer-1"), { name: "Freezer" }));
    await assertFails(deleteDoc(doc(db, "freezers/freezer-1")));
    await assertFails(setDoc(doc(db, "schedules/day-1"), { staffId: "mechanic-1" }));
    await assertFails(getDoc(doc(db, "settings/finance")));
    await assertFails(setDoc(doc(db, "settings/finance"), { kwPrice: 1 }));
    await assertFails(addDoc(collection(db, "expenses"), { amount: 1 }));
    await assertFails(deleteDoc(doc(db, "expenses/expense-1")));
  });
});

describe("manager", () => {
  beforeEach(async () => seedRole("manager-1", "manager"));

  test("cannot promote self or edit staff", async () => {
    await seedRole("mechanic-1", "mechanic");
    const db = dbFor("manager-1");
    await assertFails(updateDoc(doc(db, "staff/manager-1"), { role: "admin" }));
    await assertFails(updateDoc(doc(db, "staff/manager-1"), {
      permissions: { pl_panel: true },
    }));
    await assertFails(updateDoc(doc(db, "staff/mechanic-1"), { name: "Changed" }));
  });

  test("has UI-equivalent operational and P&L access, but not schedule access", async () => {
    await seed("expenses/expense-1", { amount: 1 });
    await seed("appointments/appointment-1", { assignees: [], status: "pending" });
    const db = dbFor("manager-1");
    await assertSucceeds(setDoc(doc(db, "settings/finance"), { kwPrice: 10 }));
    await assertSucceeds(getDoc(doc(db, "settings/finance")));
    await assertSucceeds(addDoc(collection(db, "expenses"), { amount: 2 }));
    await assertSucceeds(deleteDoc(doc(db, "expenses/expense-1")));
    const clientRef = doc(db, "clients/client-1");
    await assertSucceeds(setDoc(clientRef, { name: "Client" }));
    await assertSucceeds(updateDoc(clientRef, { name: "Updated client" }));
    await assertSucceeds(deleteDoc(clientRef));
    await assertSucceeds(setDoc(doc(db, "freezers/freezer-1"), { name: "Freezer" }));
    const taskRef = doc(db, "servicetasks/task-1");
    await assertSucceeds(setDoc(taskRef, { title: "Task" }));
    await assertSucceeds(updateDoc(taskRef, { title: "Updated task" }));
    await assertSucceeds(deleteDoc(taskRef));
    const appointmentRef = doc(db, "appointments/appointment-1");
    await assertSucceeds(updateDoc(appointmentRef, { status: "closed" }));
    await assertSucceeds(deleteDoc(appointmentRef));
    await assertFails(setDoc(doc(db, "schedules/day-1"), { staffId: "manager-1" }));
  });
});

describe("admin staff management", () => {
  beforeEach(async () => {
    await seedRole("admin-1", "admin");
    await seedRole("owner-1", "owner");
    await seedRole("mechanic-1", "mechanic");
  });

  test("can edit and assign non-owner roles", async () => {
    const ref = doc(dbFor("admin-1"), "staff/mechanic-1");
    await assertSucceeds(updateDoc(ref, { name: "Managed", role: "manager" }));
  });

  test("cannot change own role or permissions through self-update", async () => {
    const ref = doc(dbFor("admin-1"), "staff/admin-1");
    await assertFails(updateDoc(ref, { role: "owner" }));
    await assertFails(updateDoc(ref, { role: "manager" }));
    await assertFails(updateDoc(ref, {
      name: "Admin",
      permissions: { pl_panel: true },
    }));
  });

  test("cannot assign owner, edit owner, or change owner-only permissions", async () => {
    const db = dbFor("admin-1");
    await assertFails(updateDoc(doc(db, "staff/mechanic-1"), { role: "owner" }));
    await assertFails(updateDoc(doc(db, "staff/owner-1"), { name: "Touched" }));
    await assertFails(updateDoc(doc(db, "staff/mechanic-1"), {
      role: "admin",
      permissions: { pl_panel: true },
    }));
  });

  test("can manage schedules", async () => {
    const ref = doc(dbFor("admin-1"), "schedules/day-1");
    await assertSucceeds(setDoc(ref, { staffId: "mechanic-1" }));
    await assertSucceeds(deleteDoc(ref));
  });

  test("can manage standalone appointments", async () => {
    await seedAppointment("admin-appointment", ["mechanic-1"]);
    const ref = doc(dbFor("admin-1"), "appointments/admin-appointment");
    await assertSucceeds(updateDoc(ref, { assignees: ["admin-1"], assigneeNames: ["Admin"] }));
    await assertSucceeds(deleteDoc(ref));
  });
});

describe("owner", () => {
  beforeEach(async () => {
    await seedRole("owner-1", "owner");
    await seedRole("admin-1", "admin");
    await seedRole("mechanic-1", "mechanic");
  });

  test("can safely update own profile while preserving owner", async () => {
    const ref = doc(dbFor("owner-1", { role: "owner" }), "staff/owner-1");
    await assertSucceeds(updateDoc(ref, { name: "Owner name" }));
    const snapshot = await assertSucceeds(getDoc(ref));
    if (snapshot.data()?.role !== "owner") throw new Error("Owner role was not preserved");
    await assertFails(updateDoc(ref, { role: "admin" }));
  });

  test("can manage non-owner staff and admin permissions", async () => {
    const db = dbFor("owner-1", { role: "owner" });
    await assertSucceeds(updateDoc(doc(db, "staff/mechanic-1"), { role: "manager" }));
    await assertSucceeds(updateDoc(doc(db, "staff/admin-1"), {
      permissions: {
        dashboard_financials: true,
        reports_amounts: false,
        pl_panel: false,
      },
    }));
    await assertFails(updateDoc(doc(db, "staff/mechanic-1"), {
      permissions: {
        dashboard_financials: true,
        reports_amounts: true,
        pl_panel: true,
      },
    }));
  });

  test("cannot assign owner from client or change another owner", async () => {
    await seedRole("owner-2", "owner");
    const db = dbFor("owner-1", { role: "owner" });
    await assertFails(updateDoc(doc(db, "staff/mechanic-1"), { role: "owner" }));
    await assertFails(updateDoc(doc(db, "staff/owner-2"), { name: "Other owner" }));
  });

  test("retains administrative access", async () => {
    const db = dbFor("owner-1", { role: "owner" });
    await assertSucceeds(setDoc(doc(db, "settings/finance"), { kwPrice: 10 }));
    await assertSucceeds(setDoc(doc(db, "schedules/day-1"), { staffId: "admin-1" }));
    await assertSucceeds(setDoc(doc(db, "freezers/freezer-1"), { name: "Freezer" }));
    await seedAppointment("owner-appointment", ["mechanic-1"]);
    const appointmentRef = doc(db, "appointments/owner-appointment");
    await assertSucceeds(updateDoc(appointmentRef, { assignees: ["owner-1"], assigneeNames: ["Owner"] }));
    await assertSucceeds(deleteDoc(appointmentRef));
  });
});

describe("equipment monitoring access", () => {
  beforeEach(async () => {
    await seedRole("mechanic-1", "mechanic");
    await seedRole("manager-1", "manager");
    await seed("monitoringDevices/device-001", {
      name: "Камера клиента",
      enabled: true,
      clientId: "client-1",
      targetType: "chamber",
      targetId: "chamber-1",
    });
    await seed("monitoringDeviceState/device-001", {
      temperatureC: -18.5,
      measuredAt: "2026-09-13T00:00:00.000Z",
      receivedAt: "2026-09-13T00:00:01.000Z",
    });
    await seed("monitoringDeviceState/device-001/sensors/temperature-1", {
      deviceId: "device-001", sensorId: "temperature-1", temperatureC: -18.5,
      measuredAt: "2026-09-13T00:00:00.000Z", receivedAt: "2026-09-13T00:00:01.000Z",
    });
    await seed("monitoringDevices/device-001/sensors/temperature-1", {
      deviceId: "device-001", sensorId: "temperature-1", name: "Кузов",
    });
    await seed("monitoringControllerStatus/device-001", {
      statusId: "status-001",
      reportedAt: "2026-09-13T00:00:00.000Z",
      receivedAt: "2026-09-13T00:00:01.000Z",
      networkRegistered: true,
      registrationState: "home",
      rssi: 22,
      gprsConnected: true,
      mqttConnected: true,
      queueDepth: 0,
      lastFailureCode: "none",
      uptimeSeconds: 123,
    });
    await seed("monitoringControllerStatus/device-001/statusEvents/status-001", {
      statusId: "status-001", lastFailureCode: "none",
    });
    await seed("monitoringTelemetry/device-001/packets/packet-001", {
      measurements: [],
    });
    await seed("monitoringDeviceCredentials/device-001", {
      active: true,
      algorithm: "scrypt-v1",
      keySalt: "hidden",
      keyHash: "hidden",
    });
    await seed("monitoringDevices/device-001/temperatureRules/high", {
      id: "high", name: "Выше -15", enabled: true,
      direction: "above", thresholdC: -15, revision: 1, versions: [],
    });
    await seed("monitoringAlertEvents/alert-001", {
      deviceId: "device-001",
      state: "active",
      viewedBy: {},
    });
  });

  test("authenticated workers can read registry, state and requested history", async () => {
    const db = dbFor("mechanic-1");
    await assertSucceeds(getDoc(doc(db, "monitoringDevices/device-001")));
    await assertSucceeds(getDoc(doc(db, "monitoringDeviceState/device-001")));
    await assertSucceeds(getDoc(doc(db, "monitoringDeviceState/device-001/sensors/temperature-1")));
    await assertSucceeds(getDoc(doc(db, "monitoringDevices/device-001/sensors/temperature-1")));
    await assertSucceeds(getDoc(doc(db, "monitoringControllerStatus/device-001")));
    await assertSucceeds(getDoc(doc(db, "monitoringControllerStatus/device-001/statusEvents/status-001")));
    await assertSucceeds(getDoc(doc(db, "monitoringTelemetry/device-001/packets/packet-001")));
  });

  test("mechanics cannot administer devices or forge telemetry", async () => {
    const db = dbFor("mechanic-1");
    await assertFails(setDoc(doc(db, "monitoringDevices/device-002"), { enabled: true }));
    await assertFails(updateDoc(doc(db, "monitoringDevices/device-001"), { enabled: false }));
    await assertFails(setDoc(doc(db, "monitoringDeviceState/device-001"), { temperatureC: 10 }));
    await assertFails(updateDoc(doc(db, "monitoringDevices/device-001/sensors/temperature-1"), { name: "Подделка" }));
    await assertFails(setDoc(doc(db, "monitoringControllerStatus/device-001"), { mqttConnected: true }));
    await assertFails(setDoc(doc(db, "monitoringControllerStatus/device-001/statusEvents/forged"), { statusId: "forged" }));
    await assertFails(setDoc(
      doc(db, "monitoringTelemetry/device-001/packets/forged"),
      { measurements: [] },
    ));
  });

  test("manager+ can administer registry but cannot forge state, history or credentials", async () => {
    const db = dbFor("manager-1");
    const deviceRef = doc(db, "monitoringDevices/device-002");
    await assertSucceeds(setDoc(deviceRef, { enabled: true }));
    await assertSucceeds(updateDoc(deviceRef, { enabled: false }));
    await assertSucceeds(deleteDoc(deviceRef));
    await assertFails(updateDoc(doc(db, "monitoringDeviceState/device-001"), { temperatureC: 10 }));
    const sensorRef = doc(db, "monitoringDevices/device-001/sensors/temperature-1");
    await assertSucceeds(updateDoc(sensorRef, { name: "Температура кузова" }));
    await assertFails(updateDoc(sensorRef, { sensorId: "temperature-1_2" }));
    await assertFails(updateDoc(doc(db, "monitoringControllerStatus/device-001"), { mqttConnected: false }));
    await assertFails(deleteDoc(doc(db, "monitoringTelemetry/device-001/packets/packet-001")));
    await assertFails(getDoc(doc(db, "monitoringDeviceCredentials/device-001")));
    await assertFails(updateDoc(doc(db, "monitoringDeviceCredentials/device-001"), { active: false }));
  });

  test("workers can read rules but only the trusted callable backend can change versions", async () => {
    const mechanicRule = doc(dbFor("mechanic-1"), "monitoringDevices/device-001/temperatureRules/high");
    const managerRule = doc(dbFor("manager-1"), "monitoringDevices/device-001/temperatureRules/high");
    await assertSucceeds(getDoc(mechanicRule));
    await assertSucceeds(getDoc(managerRule));
    await assertFails(updateDoc(mechanicRule, { thresholdC: -10 }));
    await assertFails(updateDoc(managerRule, { thresholdC: -10 }));
    await assertFails(setDoc(
      doc(dbFor("manager-1"), "monitoringDevices/device-001/temperatureRules/forged"),
      { enabled: true, direction: "above", thresholdC: -15 },
    ));
  });

  test("workers can mark only their own alert as viewed and cannot change lifecycle fields", async () => {
    const mechanicRef = doc(dbFor("mechanic-1"), "monitoringAlertEvents/alert-001");
    await assertSucceeds(getDoc(mechanicRef));
    await assertSucceeds(updateDoc(mechanicRef, {
      "viewedBy.mechanic-1": serverTimestamp(),
    }));
    await assertFails(updateDoc(mechanicRef, {
      "viewedBy.manager-1": serverTimestamp(),
    }));
    await assertFails(updateDoc(mechanicRef, { state: "recovered" }));
    await assertFails(setDoc(doc(dbFor("manager-1"), "monitoringAlertEvents/forged"), {
      deviceId: "device-001",
      state: "active",
      viewedBy: {},
    }));
  });

  test("workers read the threshold while only manager+ can change a valid value", async () => {
    await seed("settings/monitoring", { offlineThresholdMinutes: 5 });
    await assertSucceeds(getDoc(doc(dbFor("mechanic-1"), "settings/monitoring")));
    await assertFails(updateDoc(
      doc(dbFor("mechanic-1"), "settings/monitoring"),
      { offlineThresholdMinutes: 10 },
    ));
    await assertSucceeds(updateDoc(
      doc(dbFor("manager-1"), "settings/monitoring"),
      { offlineThresholdMinutes: 10 },
    ));
    await assertFails(updateDoc(
      doc(dbFor("manager-1"), "settings/monitoring"),
      { offlineThresholdMinutes: 0 },
    ));
  });

  test("unauthenticated clients cannot read monitoring data", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "monitoringDevices/device-001")));
    await assertFails(getDoc(doc(db, "monitoringDeviceState/device-001")));
    await assertFails(getDoc(doc(db, "monitoringControllerStatus/device-001")));
    await assertFails(getDoc(doc(db, "monitoringControllerStatus/device-001/statusEvents/status-001")));
    await assertFails(getDoc(doc(db, "monitoringTelemetry/device-001/packets/packet-001")));
    await assertFails(getDoc(doc(db, "monitoringDevices/device-001/temperatureRules/high")));
    await assertFails(getDoc(doc(db, "monitoringAlertEvents/alert-001")));
  });
});

describe("default deny", () => {
  test("service command history is manager-only and all device state and command writes remain server-only", async () => {
    for (const [uid, role] of [["svc-worker", "mechanic"], ["svc-manager", "manager"], ["svc-admin", "admin"], ["svc-owner", "owner"]]) await seedRole(uid, role);
    await seed('serviceControllers/svc-demo', { name: 'Demo', enabled: true });
    await seed('serviceControllerLogs/svc-demo/entries/one', { level: 'INFO', message: 'Demo only', receivedAt: '2026-10-30' });
    await seed('serviceControllerCommands/svc-demo/commands/one', { command: 'SERVICE PING', status: 'queued', requestedAt: '2026-10-30' });
    for (const uid of ['svc-worker', 'svc-manager', 'svc-admin', 'svc-owner']) {
      const db = dbFor(uid);
      await assertSucceeds(getDoc(doc(db, 'serviceControllers/svc-demo')));
      await assertSucceeds(getDocs(query(collection(db, 'serviceControllerLogs/svc-demo/entries'), orderBy('receivedAt', 'desc'), limit(150))));
      const history = getDocs(query(collection(db, 'serviceControllerCommands/svc-demo/commands'), orderBy('requestedAt', 'desc'), limit(20)));
      if (uid === 'svc-worker') await assertFails(history); else await assertSucceeds(history);
      await assertFails(setDoc(doc(db, 'serviceControllerCommands/svc-demo/commands/forged'), { command: 'SERVICE PING', status: 'queued' }));
      await assertFails(updateDoc(doc(db, 'serviceControllers/svc-demo'), { enabled: false }));
      await assertFails(setDoc(doc(db, 'serviceControllerLogs/svc-demo/entries/forged'), { message: 'forged' }));
    }
  });

  test("work history is immutable and worker visibility is restricted to event participants", async () => {
    await seedRole("worker", "mechanic"); await seedRole("other", "mechanic"); await seedRole("boss", "admin");
    await seed("workEvents/event", { visibleTo: ["worker"], type: "completed", actorId: "worker" });
    await assertSucceeds(getDoc(doc(dbFor("worker"), "workEvents/event")));
    await assertSucceeds(getDoc(doc(dbFor("boss"), "workEvents/event")));
    await assertFails(getDoc(doc(dbFor("other"), "workEvents/event")));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "workEvents/event")));
    for (const uid of ["worker", "boss"]) {
      await assertFails(setDoc(doc(dbFor(uid), "workEvents/fake"), { visibleTo: [uid] }));
      await assertFails(updateDoc(doc(dbFor(uid), "workEvents/event"), { actorId: uid }));
      await assertFails(deleteDoc(doc(dbFor(uid), "workEvents/event")));
    }
    await assertFails(getDocs(collection(dbFor("worker"), "workEvents")));
    await assertSucceeds(getDocs(query(collection(dbFor("worker"), "workEvents"), where("visibleTo", "array-contains", "worker"))));
    await seed("ppzTasks/shared/requests/private", { action: "report" });
    await assertFails(getDoc(doc(dbFor("worker"), "ppzTasks/shared/requests/private")));
  });
  test("PPZ shared tasks are visible only to assignees and admins, writes require server", async () => {
    for (const [uid, role] of [["a", "mechanic"], ["b", "mechanic"], ["other", "mechanic"], ["boss", "admin"], ["owner", "owner"], ["manager", "manager"]]) await seedRole(uid, role);
    await seed("ppzTasks/shared", { title: "Общая задача", assignees: ["a", "b"], status: "open" });
    for (const uid of ["a", "b", "boss", "owner"]) await assertSucceeds(getDoc(doc(dbFor(uid), "ppzTasks/shared")));
    for (const uid of ["other", "manager"]) await assertFails(getDoc(doc(dbFor(uid), "ppzTasks/shared")));
    await assertSucceeds(getDocs(query(collection(dbFor("a"), "ppzTasks"), where("assignees", "array-contains", "a"))));
    await assertFails(getDocs(collection(dbFor("a"), "ppzTasks")));
    await assertSucceeds(getDocs(collection(dbFor("boss"), "ppzTasks")));
    for (const uid of ["a", "boss", "owner"]) {
      await assertFails(updateDoc(doc(dbFor(uid), "ppzTasks/shared"), { status: "done", completedBy: uid }));
      await assertFails(setDoc(doc(dbFor(uid), "ppzTasks/new"), { assignees: [uid] }));
      await assertFails(deleteDoc(doc(dbFor(uid), "ppzTasks/shared")));
    }
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "ppzTasks/shared")));
  });

  test("authenticated users cannot access unknown collections", async () => {
    await seedRole("admin-1", "admin");
    const db = dbFor("admin-1");
    await assertFails(getDoc(doc(db, "unknown/document-1")));
    await assertFails(setDoc(doc(db, "unknown/document-1"), { value: true }));
  });
});
