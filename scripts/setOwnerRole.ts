/**
 * setOwnerRole.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Устанавливает кастомный claim role: "owner" для указанного пользователя.
 * Это нужно для Firestore Security Rules — сам CRM читает роль из Firestore.
 *
 * КАК ЗАПУСТИТЬ:
 *   cd scripts
 *   npm install
 *   npx ts-node setOwnerRole.ts
 *
 * ТРЕБОВАНИЯ:
 *   scripts/serviceAccount.json — ключ сервисного аккаунта Firebase.
 *   Скачать: Firebase Console → ⚙️ Project Settings → Service accounts → Generate new private key
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const admin = require("firebase-admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require("./serviceAccount.json");

const OWNER_EMAIL = "admin@crm.lv";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function setOwnerRole() {
  const auth = admin.auth();
  const user = await auth.getUserByEmail(OWNER_EMAIL);
  await auth.setCustomUserClaims(user.uid, { role: "owner" });
  console.log(`✅ Роль owner установлена для ${OWNER_EMAIL} (uid: ${user.uid})`);
  console.log("ℹ️  Также установите role: 'owner' в документе Firestore staff/${uid}");
  process.exit(0);
}

setOwnerRole().catch((err: unknown) => {
  console.error("❌ Ошибка:", err);
  process.exit(1);
});
