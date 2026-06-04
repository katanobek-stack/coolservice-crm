/**
 * fix-freon-admin.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Исправляет задачи фреона: freonTask=true, freonAmount > 0, freonType пустой
 * → устанавливает freonType = "R134a"
 *
 * КАК ПОЛУЧИТЬ serviceAccount.json:
 *   1. Откройте https://console.firebase.google.com
 *   2. Выберите проект: coolservice-crm
 *   3. ⚙️ Project Settings → Service accounts (вкладка)
 *   4. Нажмите "Generate new private key" → скачается JSON
 *   5. Переименуйте файл в serviceAccount.json
 *   6. Положите рядом с этим скриптом: scripts/serviceAccount.json
 *
 * КАК ЗАПУСТИТЬ:
 *   cd scripts
 *   npm install
 *   node fix-freon-admin.mjs
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ─── Load service account ─────────────────────────────────────────────────────

const SA_PATH = path.join(__dirname, "serviceAccount.json");

if (!existsSync(SA_PATH)) {
  console.error("❌ Файл serviceAccount.json не найден в папке scripts/");
  console.error("");
  console.error("   Как получить:");
  console.error("   1. https://console.firebase.google.com → проект coolservice-crm");
  console.error("   2. ⚙️ Project Settings → Service accounts");
  console.error("   3. Generate new private key → скачается JSON");
  console.error("   4. Положить как: scripts/serviceAccount.json");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SA_PATH, "utf8"));

// ─── Init Firebase Admin ──────────────────────────────────────────────────────

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function needsFix(task) {
  if (!task.freonTask) return false;
  const kg = parseFloat(task.freonAmount ?? task.freonKg ?? "0") || 0;
  if (kg <= 0) return false;
  const type = (task.freonType ?? "").trim();
  return type === "";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📥 Загружаем клиентов из Firestore...");

  const snapshot = await db.collection("clients").get();
  console.log(`   Найдено клиентов: ${snapshot.size}\n`);

  let fixedTasks   = 0;
  let fixedRepairs = 0;
  let fixedClients = 0;

  const batch = db.batch(); // используем batch для атомарного обновления

  for (const doc of snapshot.docs) {
    const data    = doc.data();
    const repairs = data.repairs ?? [];
    let clientChanged = false;

    const newRepairs = repairs.map((repair) => {
      const tasks = repair.tasks ?? [];
      let repairChanged = false;

      const newTasks = tasks.map((task) => {
        if (!needsFix(task)) return task;
        fixedTasks++;
        repairChanged = true;
        return { ...task, freonType: "R134a" };
      });

      if (repairChanged) {
        fixedRepairs++;
        clientChanged = true;
        return { ...repair, tasks: newTasks };
      }
      return repair;
    });

    if (clientChanged) {
      fixedClients++;
      const clientName = data.name ?? doc.id;
      console.log(`   ✎ ${clientName}`);
      batch.update(doc.ref, { repairs: newRepairs });
    }
  }

  if (fixedTasks === 0) {
    console.log("✅ Записей с пустым freonType не найдено — всё чисто.");
    process.exit(0);
  }

  console.log("\n💾 Записываем изменения...");
  await batch.commit();

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("✅ Готово!");
  console.log(`   Клиентов обновлено: ${fixedClients}`);
  console.log(`   Нарядов затронуто:  ${fixedRepairs}`);
  console.log(`   Задач исправлено:   ${fixedTasks}`);
  console.log("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("❌ Ошибка:", err.message);
  process.exit(1);
});
