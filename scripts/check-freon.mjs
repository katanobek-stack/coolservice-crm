/**
 * check-freon.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Только статистика — ничего не меняет.
 *
 * Выводит по всем задачам где freonTask: true:
 *   - freonType = "R134a"  и freonAmount > 0
 *   - freonType = "R134a"  и freonAmount = 0
 *   - freonType = "R134a"  и freonAmount = null
 *   - freonType = null     и freonAmount > 0
 *   - freonType = null     и freonAmount = 0
 *
 * КАК ЗАПУСТИТЬ:
 *   cd scripts
 *   node check-freon.mjs
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

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();

async function main() {
  console.log("🔍 Загружаем клиентов...\n");

  const snapshot = await db.collection("clients").get();
  console.log(`   Клиентов в базе: ${snapshot.size}\n`);

  const stats = {
    r134a_kg_gt0:  { count: 0, clients: [] },  // R134a + кг > 0  (правильно)
    r134a_kg_0:    { count: 0, clients: [] },  // R134a + кг = 0  (подозрительно)
    r134a_kg_null: { count: 0, clients: [] },  // R134a + кг null (подозрительно)
    null_kg_gt0:   { count: 0, clients: [] },  // null  + кг > 0  (нужна заправка)
    null_kg_0:     { count: 0, clients: [] },  // null  + кг = 0  (норма)
    other:         { count: 0, clients: [] },  // прочее
  };

  for (const doc of snapshot.docs) {
    const data    = doc.data();
    const repairs = data.repairs ?? [];
    const name    = data.name ?? doc.id;

    for (const repair of repairs) {
      for (const task of repair.tasks ?? []) {
        if (!task.freonTask) continue;

        const rawAmount = task.freonAmount ?? task.freonKg;
        const kg = rawAmount == null ? null : parseFloat(rawAmount) || 0;
        const type = task.freonType ?? null;

        let bucket;
        if (type === "R134a" && kg != null && kg > 0)  bucket = "r134a_kg_gt0";
        else if (type === "R134a" && kg === 0)          bucket = "r134a_kg_0";
        else if (type === "R134a" && kg === null)       bucket = "r134a_kg_null";
        else if (type === null    && kg != null && kg > 0) bucket = "null_kg_gt0";
        else if (type === null    && (kg === 0 || kg === null)) bucket = "null_kg_0";
        else bucket = "other";

        stats[bucket].count++;
        if (!stats[bucket].clients.includes(name)) {
          stats[bucket].clients.push(name);
        }
      }
    }
  }

  const total = Object.values(stats).reduce((s, b) => s + b.count, 0);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("📊 Статистика freonTask=true:");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`  freonType = "R134a"  И freonAmount > 0   : ${stats.r134a_kg_gt0.count} задач  ✅ правильно`);
  if (stats.r134a_kg_gt0.clients.length) {
    console.log(`    Клиенты: ${stats.r134a_kg_gt0.clients.join(", ")}`);
  }

  console.log(`  freonType = "R134a"  И freonAmount = 0   : ${stats.r134a_kg_0.count} задач  ⚠️  откат нужен`);
  if (stats.r134a_kg_0.clients.length) {
    console.log(`    Клиенты: ${stats.r134a_kg_0.clients.join(", ")}`);
  }

  console.log(`  freonType = "R134a"  И freonAmount = null: ${stats.r134a_kg_null.count} задач  ⚠️  откат нужен`);
  if (stats.r134a_kg_null.clients.length) {
    console.log(`    Клиенты: ${stats.r134a_kg_null.clients.join(", ")}`);
  }

  console.log(`  freonType = null     И freonAmount > 0   : ${stats.null_kg_gt0.count} задач  ℹ️  кг есть, тип не указан`);
  if (stats.null_kg_gt0.clients.length) {
    console.log(`    Клиенты: ${stats.null_kg_gt0.clients.join(", ")}`);
  }

  console.log(`  freonType = null     И freonAmount = 0   : ${stats.null_kg_0.count} задач  ✅ норма`);
  if (stats.null_kg_0.clients.length && stats.null_kg_0.count <= 20) {
    console.log(`    Клиенты: ${stats.null_kg_0.clients.join(", ")}`);
  }

  if (stats.other.count > 0) {
    console.log(`  Прочие комбинации                        : ${stats.other.count} задач`);
    if (stats.other.clients.length) {
      console.log(`    Клиенты: ${stats.other.clients.join(", ")}`);
    }
  }

  console.log("");
  console.log(`  Итого freonTask=true: ${total} задач`);
  console.log(`  Требуют отката:       ${stats.r134a_kg_0.count + stats.r134a_kg_null.count} задач`);
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ℹ️  Ничего не изменено. Для отката запустите: node fix-freon-rollback.mjs");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("❌ Ошибка:", err.message);
  process.exit(1);
});
