# История изменений телеметрии

## 2026-09-18 — диагностика досылки и полный график периода

**Причина.** После досылки около 1600 telemetry-точек bridge сообщал только
`HTTP 202`, а суточный график не заполнил наблюдавшийся разрыв. Требовалось
отличать новую запись от дубликата и исключить скрытие точек клиентом.

**Доказано аудитом.** `HTTP 202` в прежней функции уже означал создание нового
документа пакета; дубликат `packetId` возвращал `HTTP 200` и не создавал запись.
Температура хранится в `monitoringTelemetry/{deviceId}/packets/{packetId}`.
До исправления выборка ограничивалась документами пакетов: 120 за 1 час, 1440
за 12 часов и 2880 за 24 часа. Поэтому лимит 120 не мог объяснить 1600
одноточечных пакетов именно за сутки; старый SVG также не делал downsampling.

**Что пока неизвестно.** Без журналируемых `outcome` и фактических `measuredAt`
досланной серии нельзя ретроспективно доказать причину конкретного разрыва.
В частности, точки старше скользящего выбранного окна по `measuredAt` не будут
видны на графике, хотя останутся в истории Firestore.

**Изменено.**

- `ingestTelemetry` теперь отвечает только безопасными полями `packetId`,
  `outcome` (`stored` или `duplicate`), `measurementsReceived` и
  `measurementsCreated`.
- Bridge читает этот ответ и пишет `stored`/`duplicate`/`unknown`, не меняя
  MQTT topics, SQLite durable-очередь или env-переменные.
- Лимит документов истории удалён: за выбранный 1/12/24-часовой период
  выбираются все валидные точки, затем сортируются по `measuredAt`.
- Для SVG используется bounded downsampling до 600 точек: сохраняются первая,
  последняя и min/max каждого временного сегмента. Счётчик и min/avg/max
  вычисляются по полной серии.
- Добавлены проверки replay `packetId`, 1600 точек, большого разрыва, краёв и
  экстремумов.

**Commit.** `24207035191d6eabad4173bf340aa1a58c94d654`
([GitHub](https://github.com/katanobek-stack/coolservice-crm/commit/24207035191d6eabad4173bf340aa1a58c94d654)).

**Проверки.** Прошли `functions npm run build`, `web npm run typecheck`,
`web npm run test:unit` (40 тестов), `web npm run build`, `git diff --check`.
Эмуляторные tests не запускались: в локальном окружении нет Java. Python tests
bridge не запускались: Python отсутствует.

**Публикация.** На момент этой записи функция, Pages и VPS для этого изменения
ещё не опубликованы. Сначала публикуется только `functions:ingestTelemetry`,
затем bridge обновляется вручную отдельно. PR, merge commit и deploy-ссылки
будут добавлены после их фактического появления.

**Намеренно не менялось.** Firestore Rules, production Firestore-данные,
VPS/service/systemd/Mosquitto, MQTT-пароли, device keys и firmware.

## 2026-09-17 — совместимый артефакт bridge для реального VPS

**Commit.** `f457488c1f77d185cc09f08459fca267ffc75e18`
([GitHub](https://github.com/katanobek-stack/coolservice-crm/commit/f457488c1f77d185cc09f08459fca267ffc75e18)).

`vps/crm-mqtt-bridge/bridge.py` основан на реальном работающем bridge:
сохраняет telemetry, добавляет status и миграцию SQLite без потери pending
telemetry. Он является артефактом для ручного обновления, а не изменением VPS.
