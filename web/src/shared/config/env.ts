type RequiredFirebaseEnvKey =
  | "VITE_FIREBASE_API_KEY"
  | "VITE_FIREBASE_AUTH_DOMAIN"
  | "VITE_FIREBASE_PROJECT_ID"
  | "VITE_FIREBASE_STORAGE_BUCKET"
  | "VITE_FIREBASE_MESSAGING_SENDER_ID"
  | "VITE_FIREBASE_APP_ID";

function requireEnv(key: RequiredFirebaseEnvKey, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${key}. Copy web/.env.example to web/.env and fill Firebase keys.`,
    );
  }
  return value;
}

export function getFirebaseConfig() {
  return {
    apiKey: requireEnv("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: requireEnv("VITE_FIREBASE_AUTH_DOMAIN", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: requireEnv("VITE_FIREBASE_PROJECT_ID", import.meta.env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: requireEnv("VITE_FIREBASE_STORAGE_BUCKET", import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: requireEnv(
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId: requireEnv("VITE_FIREBASE_APP_ID", import.meta.env.VITE_FIREBASE_APP_ID),
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
  };
}

export function getFirebaseVapidKey(): string | undefined {
  const key = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  return key || undefined;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID &&
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET &&
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
      import.meta.env.VITE_FIREBASE_APP_ID,
  );
}
