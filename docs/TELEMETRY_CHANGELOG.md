# История изменений телеметрии

## 2026-09-20 — dry-run backfill `device-001` за 2026-09-19 UTC

**Результат read-only dry-run.** Просканировано 8 047 legacy packet-документов
`device-001`. По `measuredAt` за 2026-09-19 UTC запланированы 360 размещённых
points; `unplacedPoints` по `receivedAt` за тот же день — 0. Это затронет 6
уникальных hour-rollup документов. Уже существующих stableMeasurementId — 0,
ошибок в выбранном диапазоне — 0.

**Оценка execute.** Для этого логического диапазона потребуется 360 point
creates, 360 packet/hour rollup updates и 360 checkpoint writes: всего примерно
1 080 Firestore writes. Никаких writes, checkpoint, backfill, deploy или
изменений production-данных dry-run не выполнил.

## 2026-09-20 — PR A: dual-write `ingestTelemetry` опубликован и проверен

**Публикация.** В `coolservice-crm` опубликована только Cloud Function
`ingestTelemetry` (europe-west1). Firestore Rules и indexes не публиковались;
backfill не запускался.

**Проверка.** POST с `Content-Type: application/json` без Authorization вернул
HTTP 401 `invalid_device_credentials`. Read-only проверка следующей естественно
полученной telemetry `device-001` подтвердила создание deterministic point и
соответствующего hour-rollup: point имеет `exact/realtime`, rollup существует и
содержит `exact_realtime` 5-минутную корзину. Проверка не создавала тестовых
пакетов и не изменяла legacy packets, VPS, прошивку или старые production-данные.

## 2026-09-20 — PR A: read-модель history и rollup подготовлены локально

**Причина.** Raw packet-массивы не масштабируются для navigator и периодов 3/7/30
дней. Нужны точные точки для окна до 24 часов и серверные 5-минутные min–max
агрегаты для обзора без ложной линии по average.

**Изменено локально.** `ingestTelemetry` после packet-дедупликации создаёт
детерминированные points/unplacedPoints и обновляет часовой rollup с отдельными
quality series и 5-минутными корзинами. Подготовлены Rules, indexes и ручной
возобновляемый backfill-инструмент с dry-run, checkpoint и throttling, а также
read-only сверка `device-001` legacy/new model за UTC-день.

**Проверки и публикация.** Локально прошли functions build и unit-тест
read-модели, web typecheck/unit tests/build, index JSON test и `git diff --check`.
Firebase Emulator не запустился: в окружении нет Java (`Could not spawn java -version`), поэтому emulator integration/rules test остаются непроверенными
локально и должны пройти в CI с Java. Deploy, production backfill,
production-данные, web navigator, VPS и firmware не изменялись. Rollup и point
retention только документированы через `expireAt`; Firestore TTL не включён.

## 2026-09-20 — качество доставки точки (`deliveryQuality`)

**Причина.** Контроллер может продолжать измерять температуру при отсутствии
подтверждённой MQTT-связи. Такие точки приходят позже из локальной очереди, но
их реальное `measuredAt` должно оставаться на шкале графика.

**Изменено локально.** В telemetry добавлено независимое
`deliveryQuality: realtime|delayed`; отсутствие поля в старых сообщениях
нормализуется как `realtime`. Bridge безопасно передаёт поле, а
`ingestTelemetry` валидирует и сохраняет его вместе с точкой, не меняя
packetId-дедупликацию, последнюю температуру или аварии. В CRM `realtime`
отображается синим, `delayed` — оранжевым; `estimated` остаётся пунктиром.
Точка с `unplaced` по-прежнему не входит в график и статистику.

**Проверки.** Добавлены тесты функции, bridge и графической логики для
legacy-default, обоих delivery quality, их сочетания с `timeQuality`, dedupe и
downsampling. Публикация и обновление VPS не выполнялись.

**Намеренно не менялось.** Firmware ESP32, LittleFS, PUBACK, PWRKEY и recovery
контроллера; Firestore Rules/indexes, production-данные, env-файлы и billing.

## 2026-09-20 — точки без достоверного времени (`unplaced`)

**Причина.** Очередь ESP32 может содержать реальные измерения от предыдущего
включения контроллера. Без UTC их нельзя назначать на временную шкалу: между
включениями могло не быть питания.

**Изменено локально.** В MQTT/HTTPS telemetry добавлен третий `timeQuality`:
`unplaced`. Для `exact` и `estimated` `measuredAt` по-прежнему обязателен;
`unplaced` принимает только точку без `measuredAt` и с `sensorId`. Приёмник
сохраняет её идемпотентно с `packetId`, температурой, `sensorId`, качеством
времени и серверным `receivedAt`, но не меняет состояние последней температуры,
аварии, график или min/avg/max. CRM отдельно ограниченно читает и показывает
счётчик и список таких точек. Старые записи без `timeQuality` остаются `exact`.

**Публикация CRM.** Опубликованы только `functions:ingestTelemetry` и
Firestore index. На момент публикации CRM обновление VPS намеренно не
выполнялось: перед первой telemetry с `timeQuality: "unplaced"` нужно вручную установить
`vps/crm-mqtt-bridge/bridge.py` по безопасной процедуре из его README.
Артефакт сверен с рабочей live-версией: сохранены 32 delivery workers,
SQLite `delivery_state`/inflight recovery, telemetry и status topics, STATS и
outcome logging; добавлена лишь передача `timeQuality`, включая `unplaced`.
Прошивка не меняется в этом этапе.

**VPS, 20.09.** Обновление `bridge.py` успешно выполнено вручную. Service
`crm-mqtt-bridge.service` active; bridge подписан на MQTT telemetry и status,
запустил 32 delivery workers, а durable SQLite-очередь имеет глубину 0.

**Индекс Firestore.** Отдельный запрос CRM для `unplaced` использует
`hasUnplaced == true` и `receivedAt desc`; для него добавлен составной индекс
`packets(hasUnplaced ASC, receivedAt DESC)` с областью `COLLECTION` в
`firestore.indexes.json`. Он подключён в `firebase.json` и опубликован в
production со статусом `Enabled`. Добавлены проверка JSON-конфигурации и
emulator test запроса.

**Намеренно не менялось.** Production Firestore-данные и Rules, VPS,
systemd, Mosquitto, ключи, env-файлы, firmware и billing.

## 2026-09-19 — outcome telemetry в журнале live bridge

**Причина.** После установки совместимого с live bridge новые telemetry
принимались с HTTP 202, но журнал не показывал, была ли создана новая точка
либо `packetId` обработан как дубликат.

**Изменено локально.** После успешного HTTP 200/202 bridge безопасно читает
только JSON-результат `ingestTelemetry`: `stored` пишет число созданных
измерений, `duplicate` — `created=0`. Старый, не-JSON или некорректный
successful body пишется как `outcome=unknown` и не останавливает delivery
worker. Очередь, 32 workers, `delivery_state`/inflight, STATS, status topic и
`timeQuality` не изменены.

**Публикация.** Не выполнялась: VPS, systemd, Mosquitto и env-файлы не
изменялись. Обновление `bridge.py` на VPS остаётся отдельной ручной операцией.

## 2026-09-19 — совместимый bridge-артефакт для `timeQuality`

**Причина.** Предыдущий repo-артефакт `vps/crm-mqtt-bridge/bridge.py` содержал
поддержку `timeQuality`, но мог откатить проверенную live-логику параллельной
доставки: 32 workers, `delivery_state`/`claimed_at`, восстановление inflight
после restart и STATS.

**Изменено локально.** Канонический deploy-файл снова основан на
`bridge-live-before-time-quality.py` — локальном reference-файле текущего VPS.
Добавлено только необязательное `timeQuality` (`exact` или `estimated`) из
telemetry MQTT-пакета. Отсутствующее поле не пересылается, поэтому
`ingestTelemetry` нормализует его как `exact`. Reference-файл не предназначен
для Git и не будет коммититься.

**Публикация.** Не выполнялась: VPS, systemd, Mosquitto и env-файлы не
изменялись. Обновление `bridge.py` на VPS остаётся отдельной ручной операцией.

## 2026-09-18 — качество времени telemetry

**Причина.** После длительного отсутствия UTC контроллер в будущем сможет
сообщать, что время измерения восстановлено оценочно, не смешивая такой момент
с подтверждённым UTC на графике.

**Изменено локально.** В `measurements[]` добавлено необязательное
`timeQuality: exact|estimated`; старые записи без поля считаются `exact`.
Приёмник сохраняет нормализованное значение, bridge передаёт необязательное
поле из MQTT в HTTPS, а CRM различает его цветом и стилем сегмента. При
совпадении `measuredAt` точная точка приоритетнее оценочной. Статистика
min/avg/max по-прежнему использует все температуры, отдельно показан счётчик
оценочных времён.

**Публикация.** Не выполнялась. До включения на реальном bridge требуется
отдельно опубликовать `functions:ingestTelemetry`, затем вручную обновить
только `vps/crm-mqtt-bridge/bridge.py`; прошивка в этом этапе не меняется.

**Проверки.** Прошли `functions npm run build`, `web npm run typecheck`,
`web npm run test:unit` (42 tests), `web npm run build` и `git diff --check`.
Эмуляторный контрактный test не запускался: в окружении отсутствует Java.
Python отсутствует, поэтому локальный test bridge не запускался.

**Намеренно не менялось.** Production Firestore-данные, Firestore Rules,
VPS/service/systemd/Mosquitto, MQTT-пароли, device keys и firmware.

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
