/**
 * setOwnerRole.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Устанавливает роль owner для admin@crm.lv:
 *   1. Firebase Auth custom claim: role = "owner"
 *   2. Firestore staff/<uid>: role = "owner"
 *
 * КАК ЗАПУСТИТЬ:
 *   cd scripts
 *   npm install
 *   node setOwnerRole.mjs
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
  console.error("   Как получить: Firebase Console → ⚙️ Project Settings → Service accounts → Generate new private key");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SA_PATH, "utf8"));
const admin = require("firebase-admin");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const OWNER_EMAIL = "admin@crm.lv";

async function main() {
  const auth = admin.auth();
  const db   = admin.firestore();

  console.log(`🔍 Ищем пользователя ${OWNER_EMAIL}...`);
  const user = await auth.getUserByEmail(OWNER_EMAIL);
  console.log(`   uid: ${user.uid}`);

  console.log("⚙️  Устанавливаем custom claim role=owner...");
  await auth.setCustomUserClaims(user.uid, { role: "owner" });

  console.log("📝 Обновляем Firestore staff document...");
  await db.collection("staff").doc(user.uid).set({ role: "owner" }, { merge: true });

  console.log(`\n✅ Готово! Роль owner установлена для ${OWNER_EMAIL}`);
  console.log("   ✓ Firebase Auth custom claim: role=owner");
  console.log("   ✓ Firestore staff/" + user.uid + ": role=owner");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Ошибка:", err);
  process.exit(1);
});
