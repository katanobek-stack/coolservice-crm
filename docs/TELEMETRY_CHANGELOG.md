# История изменений телеметрии

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

**Публикация.** Не выполнялась. До использования на устройстве требуется
отдельно опубликовать только `functions:ingestTelemetry`, затем вручную
обновить только `vps/crm-mqtt-bridge/bridge.py`; прошивка не меняется в этом
этапе.

**Индекс Firestore.** Отдельный запрос CRM для `unplaced` использует
`hasUnplaced == true` и `receivedAt desc`; для него добавлен составной индекс
`packets(hasUnplaced ASC, receivedAt DESC)` с областью `COLLECTION` в
`firestore.indexes.json`. Он подключён в `firebase.json`; до будущей публикации
индекс не существует в production. Добавлены проверка JSON-конфигурации и
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
