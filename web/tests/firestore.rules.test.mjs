import { readFile } from "node:fs/promises";
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
  getDoc,
  setDoc,
  updateDoc,
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
    await assertSucceeds(updateDoc(doc(db, "servicetasks/task-1"), { status: "done" }));
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

describe("default deny", () => {
  test("authenticated users cannot access unknown collections", async () => {
    await seedRole("admin-1", "admin");
    const db = dbFor("admin-1");
    await assertFails(getDoc(doc(db, "unknown/document-1")));
    await assertFails(setDoc(doc(db, "unknown/document-1"), { value: true }));
  });
});
