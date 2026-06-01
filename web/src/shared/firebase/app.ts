import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseConfig, isFirebaseConfigured } from "../config/env";

let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

export function initFirebase(): FirebaseApp {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase is not configured. Add keys to web/.env (see web/.env.example).",
    );
  }

  firebaseApp = initializeApp(getFirebaseConfig());
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  storage = getStorage(firebaseApp);

  return firebaseApp;
}

export function getFirebaseApp(): FirebaseApp {
  return initFirebase();
}

export function getFirebaseAuth(): Auth {
  initFirebase();
  return auth!;
}

export function getFirebaseDb(): Firestore {
  initFirebase();
  return db!;
}

export function getFirebaseStorage(): FirebaseStorage {
  initFirebase();
  return storage!;
}
