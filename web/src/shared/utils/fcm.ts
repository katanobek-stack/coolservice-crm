import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { getFirebaseApp } from "../firebase/app";
import { getFirebaseDb } from "../firebase/app";
import { arrayUnion, doc, setDoc } from "firebase/firestore";
import { getFirebaseVapidKey } from "../config/env";

let fcmInitialized = false;

export async function initFCM(uid: string, fcmTokens: string[] = []): Promise<void> {
  if (fcmInitialized) return;

  const supported = await isSupported().catch(() => false);
  if (!supported) return;

  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const vapidKey = getFirebaseVapidKey();
  if (!vapidKey) return;

  try {
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    const messaging = getMessaging(getFirebaseApp());
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });

    if (token && !fcmTokens.includes(token)) {
      await setDoc(
        doc(getFirebaseDb(), "staff", uid),
        { fcmTokens: arrayUnion(token), fcmUpdatedAt: new Date().toISOString() },
        { merge: true },
      );
    }

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "РефСервисДВ";
      const body  = payload.notification?.body  ?? "";
      showBrowserNotification(title, body);
    });

    fcmInitialized = true;
  } catch (err) {
    console.warn("[FCM] init error", err);
  }
}

export async function requestNotificationPermission(uid: string, fcmTokens: string[] = []): Promise<void> {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    await initFCM(uid, fcmTokens);
    return;
  }
  if (Notification.permission === "denied") return;

  const perm = await Notification.requestPermission().catch(() => "denied");
  if (perm === "granted") {
    await initFCM(uid, fcmTokens);
  }
}

export function showBrowserNotification(title: string, body: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;

  try {
    const n = new Notification(title, {
      body,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230284c7'/><text x='50%25' y='52%25' dominant-baseline='middle' text-anchor='middle' font-size='62'>❄️</text></svg>",
      tag:  "refservicedv-task",
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => { try { n.close(); } catch { /* ignore */ } }, 8000);
  } catch { /* ignore */ }
}
