/**
 * fix-freon-rollback.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Откат изменений от fix-freon-admin.mjs.
 *
 * Находит задачи где скрипт ошибочно поставил freonType = "R134a":
 *   freonTask: true
 *   freonType: "R134a"
 *   freonAmount = 0 или null (реальной заправки не было)
 *
 * → Возвращает freonType = null для таких задач.
 *
 * Задачи с freonAmount > 0 НЕ трогаются — там реально была заправка.
 *
 * КАК ЗАПУСТИТЬ:
 *   cd scripts
 *   node fix-freon-rollback.mjs
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

const SA_PATH = path.join(__dirname, "serviceAccount.json");

if (!existsSync(SA_PATH)) {
  console.error("❌ Файл serviceAccount.json не найден в папке scripts/");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SA_PATH, "utf8"));

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Задача подлежит откату если freonType = "R134a" но реальной заправки не было
function needsRollback(task) {
  if (!task.freonTask) return false;
  if (task.freonType !== "R134a") return false;
  const kg = parseFloat(task.freonAmount ?? task.freonKg ?? "0") || 0;
  return kg <= 0;
}

async function main() {
  console.log("🔍 Сканируем базу клиентов...\n");

  const snapshot = await db.collection("clients").get();
  console.log(`   Клиентов в базе: ${snapshot.size}\n`);

  let totalTasks   = 0;
  let totalRepairs = 0;
  let totalClients = 0;
  const report = [];

  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const data    = doc.data();
    const repairs = data.repairs ?? [];
    let clientChanged = false;
    let clientTaskCount = 0;

    const newRepairs = repairs.map((repair) => {
      const tasks = repair.tasks ?? [];
      let repairChanged = false;

      const newTasks = tasks.map((task) => {
        if (!needsRollback(task)) return task;
        totalTasks++;
        clientTaskCount++;
        repairChanged = true;
        return { ...task, freonType: null };
      });

      if (repairChanged) {
        totalRepairs++;
        clientChanged = true;
        return { ...repair, tasks: newTasks };
      }
      return repair;
    });

    if (clientChanged) {
      totalClients++;
      const clientName = data.name ?? doc.id;
      report.push(`   • ${clientName} (задач к откату: ${clientTaskCount})`);
      batch.update(doc.ref, { repairs: newRepairs });
    }
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("📋 Найдено записей для отката (freonAmount=0, freonType=R134a):");
  console.log(`   Клиентов: ${totalClients}`);
  console.log(`   Нарядов:  ${totalRepairs}`);
  console.log(`   Задач:    ${totalTasks}`);
  console.log("───────────────────────────────────────────────────");
  if (report.length > 0) {
    report.forEach((line) => console.log(line));
  }
  console.log("═══════════════════════════════════════════════════\n");

  if (totalTasks === 0) {
    console.log("✅ Нет записей для отката — всё чисто.");
    process.exit(0);
  }

  console.log("💾 Применяем откат...");
  await batch.commit();

  console.log("");
  console.log("✅ Откат выполнен!");
  console.log(`   freonType → null восстановлен у ${totalTasks} задач`);
  console.log(`   Записи с freonAmount > 0 не тронуты.\n`);
}

main().catch((err) => {
  console.error("❌ Ошибка:", err.message);
  process.exit(1);
});
