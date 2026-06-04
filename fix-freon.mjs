/**
 * fix-freon.mjs
 * Исправляет задачи где freonTask=true, freonAmount>0, но freonType не указан.
 * Устанавливает freonType = "R134a".
 *
 * Usage: node fix-freon.mjs <пароль-firebase>
 */

const API_KEY    = "AIzaSyA2r9KzhWVPIvg0L8EoOb6vQHpk4SCZ8dw";
const PROJECT_ID = "coolservice-crm";
const EMAIL      = "Katanobek@ya.ru";
const DB         = `projects/${PROJECT_ID}/databases/(default)/documents`;
const FS_BASE    = `https://firestore.googleapis.com/v1/${DB}`;
const AUTH_URL   = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;

// ─── Firestore typed-value ↔ plain JS helpers ─────────────────────────────────

function fsToJs(value) {
  if (value.stringValue  !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue  !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue    !== undefined) return null;
  if (value.arrayValue) {
    return (value.arrayValue.values ?? []).map(fsToJs);
  }
  if (value.mapValue) {
    const obj = {};
    for (const [k, v] of Object.entries(value.mapValue.fields ?? {})) {
      obj[k] = fsToJs(v);
    }
    return obj;
  }
  return undefined;
}

function jsToFs(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(jsToFs) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) fields[k] = jsToFs(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function signIn(password) {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed: ${data.error?.message ?? res.status}`);
  console.log(`✓ Вошли как ${EMAIL}`);
  return data.idToken;
}

async function listClients(token) {
  const clients = [];
  let pageToken = null;
  do {
    const url = `${FS_BASE}/clients?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`List failed: ${JSON.stringify(data.error)}`);
    for (const doc of data.documents ?? []) {
      const id     = doc.name.split("/").pop();
      const fields = {};
      for (const [k, v] of Object.entries(doc.fields ?? {})) {
        fields[k] = fsToJs(v);
      }
      clients.push({ id, fields, docName: doc.name });
    }
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);
  return clients;
}

async function patchRepairs(token, docName, repairs) {
  const url  = `${encodeURI(docName)}?updateMask.fieldPaths=repairs`;
  const body = {
    fields: { repairs: jsToFs(repairs) },
  };
  const res  = await fetch(url, {
    method:  "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Patch failed for ${docName}: ${JSON.stringify(err.error)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: node fix-freon.mjs <firebase-password>");
    process.exit(1);
  }

  const token = await signIn(password);

  console.log("📥 Загружаем клиентов...");
  const clients = await listClients(token);
  console.log(`   Найдено клиентов: ${clients.length}`);

  let fixedTasks  = 0;
  let fixedRepairs = 0;
  let fixedClients = 0;

  for (const client of clients) {
    const repairs = client.fields.repairs ?? [];
    let clientChanged = false;

    const newRepairs = repairs.map((repair) => {
      const tasks = repair.tasks ?? [];
      let repairChanged = false;

      const newTasks = tasks.map((task) => {
        if (!task.freonTask) return task;

        const kg = parseFloat(task.freonAmount ?? task.freonKg ?? "0") || 0;
        const hasType = task.freonType && task.freonType.trim() !== "";

        if (kg > 0 && !hasType) {
          fixedTasks++;
          repairChanged = true;
          return { ...task, freonType: "R134a" };
        }
        return task;
      });

      if (repairChanged) {
        fixedRepairs++;
        clientChanged = true;
      }
      return repairChanged ? { ...repair, tasks: newTasks } : repair;
    });

    if (clientChanged) {
      fixedClients++;
      process.stdout.write(`   Обновляем клиента: ${client.fields.name ?? client.id}... `);
      await patchRepairs(token, client.docName, newRepairs);
      console.log("✓");
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log(`✅ Готово!`);
  console.log(`   Клиентов обновлено: ${fixedClients}`);
  console.log(`   Нарядов затронуто:  ${fixedRepairs}`);
  console.log(`   Задач исправлено:   ${fixedTasks}`);
  if (fixedTasks === 0) {
    console.log("   Записей с пустым freonType не найдено.");
  }
  console.log("═══════════════════════════════════════");
}

main().catch((err) => { console.error("❌ Ошибка:", err.message); process.exit(1); });
