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
  if (useFirebaseEmulators()) {
    return {
      apiKey: "demo-api-key",
      authDomain: "demo-coolservice-crm.firebaseapp.com",
      projectId: "demo-coolservice-crm",
      storageBucket: "demo-coolservice-crm.appspot.com",
      messagingSenderId: "0",
      appId: "demo-app-id",
      measurementId: undefined,
    };
  }
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
  if (useFirebaseEmulators()) return true;
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID &&
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET &&
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
      import.meta.env.VITE_FIREBASE_APP_ID,
  );
}

export function useFirebaseEmulators(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
}
