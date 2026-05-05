// firebase-messaging-sw.js
// ───────────────────────────────────────────────────────────────────────
// Положи этот файл в КОРЕНЬ репозитория GitHub Pages — рядом с index.html
// Без него полноценные push-уведомления при закрытом приложении НЕ работают.
//
// После размещения файла:
// 1) Зайди в Firebase Console → Project Settings → Cloud Messaging
// 2) Сгенерируй "Web Push certificates" (VAPID key) — скопируй ключ
// 3) Добавь его в index.html в место регистрации FCM (см. ниже)
// 4) В консоли можно тестировать через "Send test message"
//
// Без серверной части, которая шлёт пуши, этот воркер просто принимает
// уведомления, отправленные вручную через Firebase Console или твой
// Cloudflare Worker, который в будущем сможет слать FCM-сообщения.
// ───────────────────────────────────────────────────────────────────────

importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA2r9KzhWVPIvg0L8EoOb6vQHpk4SCZ8dw",
  authDomain: "coolservice-crm.firebaseapp.com",
  projectId: "coolservice-crm",
  storageBucket: "coolservice-crm.firebasestorage.app",
  messagingSenderId: "871007711725",
  appId: "1:871007711725:web:0f717e2edc84e6907877e4"
});

var messaging = firebase.messaging();

// Обработчик push-сообщения, когда вкладка/приложение закрыто
messaging.onBackgroundMessage(function(payload) {
  var title = (payload.notification && payload.notification.title) || "РефСервисДВ";
  var body = (payload.notification && payload.notification.body) || "Новое уведомление";
  var icon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%230284c7'/><text x='50%25' y='52%25' dominant-baseline='middle' text-anchor='middle' font-size='62'>%E2%9D%84%EF%B8%8F</text></svg>";
  self.registration.showNotification(title, {
    body: body,
    icon: icon,
    badge: icon,
    tag: "refservicedv-push",
    data: payload.data || {}
  });
});

// Открыть приложение по клику на уведомление
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:"window"}).then(function(list){
      for (var i=0;i<list.length;i++){
        var c=list[i];
        if (c.url.indexOf(self.location.origin)===0 && "focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});

// Базовый офлайн-кеш (опционально, чтобы оба воркера не конфликтовали — этот не делает fetch-кэш)
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });
