# Эксплуатация телеметрии

## Схема

```text
ESP32 + SIM800C
  └─ MQTT QoS 1 → Mosquitto VPS
       └─ crm-mqtt-bridge: SQLite durable queue → HTTPS
            └─ Firebase Functions (europe-west1)
                 ├─ ingestTelemetry → Firestore → CRM «Мониторинг»
                 └─ ingestControllerStatus → Firestore → «Связь и диагностика»
```

Контроллер не имеет доступа к Firebase Auth или Firestore. Bridge передаёт
существующий отзываемый ключ устройства только HTTPS-запросу функции через
`Authorization: Bearer …`; ключи, MQTT-пароли и содержимое env-файлов не
публикуются и не пишутся в журнал.

## MQTT-контракты

Telemetry приходит по `coolmonitor/devices/{controllerId}/telemetry`:

```json
{
  "controllerId": "device-001",
  "packetId": "stable-unique-packet-id",
  "sensorId": "temperature-1",
  "measuredAt": "2026-09-18T00:00:00Z",
  "value": -18.5,
  "timeQuality": "exact",
  "deliveryQuality": "realtime"
}
```

Bridge проверяет topic и `controllerId`, затем преобразует это в неизменяемый
контракт `ingestTelemetry`: `deviceId`, `packetId` и массив
`measurements[{ measuredAt?, temperatureC, sensorId?, timeQuality, deliveryQuality }]`.

`timeQuality` допускает `exact`, `estimated` и `unplaced`. Поле необязательно для
старых MQTT- и HTTP-пакетов: его отсутствие на bridge и в `ingestTelemetry`
трактуется как `exact`. `estimated` означает, что контроллер восстановил время
после отсутствия UTC; температура остаётся реальной, оценочным является только
время измерения.

`deliveryQuality` независимо описывает качество доставки в момент измерения и
допускает `realtime` и `delayed`. Поле необязательно для старых MQTT- и
HTTP-пакетов: его отсутствие на bridge и в `ingestTelemetry` трактуется как
`realtime`. `delayed` означает: «Точка измерена при отсутствии подтверждённой
MQTT-связи и доставлена позже». В CRM цвет показывает delivery quality
(`realtime` — синий, `delayed` — оранжевый), а пунктир показывает
`timeQuality: estimated`; поэтому оценочная отложенная точка остаётся оранжевой
и пунктирной. Линия не соединяет участки при изменении любого из двух качеств.

Для `exact` и `estimated` `measuredAt` обязателен. `unplaced` означает реальную
сохранённую ESP32 точку от предыдущего включения без достоверного времени:
`measuredAt` в ней **должен отсутствовать**, а `sensorId` обязателен. Bridge
передаёт её как обычный идемпотентный packet, но `ingestTelemetry` сохраняет
только температуру, `sensorId`, оба качества, `packetId` и серверный
`receivedAt`. Такая точка не обновляет последнюю температуру, не участвует в
авариях, min/avg/max и графике; в карточке есть отдельный компактный список
«Без достоверного времени».

Пример MQTT payload для `unplaced`:

```json
{
  "controllerId": "device-001",
  "packetId": "previous-boot-queue-17",
  "sensorId": "temperature-1",
  "value": -18.5,
  "timeQuality": "unplaced"
}
```

Status приходит независимо по `coolmonitor/devices/{controllerId}/status`:

```json
{
  "controllerId": "device-001",
  "statusId": "stable-unique-status-id",
  "reportedAt": "2026-09-18T00:00:00Z",
  "networkRegistered": true,
  "registrationState": "home",
  "rssi": 20,
  "gprsConnected": true,
  "mqttConnected": true,
  "queueDepth": 0,
  "lastFailureCode": "none",
  "uptimeSeconds": 3600
}
```

Полный список допустимых значений и правила валидации status — в
[MQTT_CONTROLLER_STATUS.md](MQTT_CONTROLLER_STATUS.md).

## Хранение и идемпотентность

- Реестр и привязка: `monitoringDevices/{deviceId}`.
- Credentials: `monitoringDeviceCredentials/{deviceId}`; браузер их не читает.
- История температуры: `monitoringTelemetry/{deviceId}/packets/{packetId}`.
  Один документ содержит массив принятых измерений, время получения и границы
  измерений, включая оба качества. Документы с `unplaced` дополнительно
  отмечаются `hasUnplaced` и `unplacedCount`; у точки нет `measuredAt`.
- Последняя температура: `monitoringDeviceState/{deviceId}`.
- Последний status: `monitoringControllerStatus/{controllerId}`; события status
  отдельно в `monitoringControllerStatus/{controllerId}/statusEvents/{statusId}`.

### Подготовка масштабируемой history read-модели

PR A добавляет backend-only read-модель; текущий CRM-график пока продолжает
читать `packets` и не показывает периоды 3/7/30 дней. После отдельной
публикации `ingestTelemetry` каждая **новая** точка дополнительно создаёт
детерминированный документ `points/{stableMeasurementId}`. ID вычисляется из
`packetId` и индекса measurement, поэтому повторный `packetId` не может создать
вторую point или повторно изменить rollup.

- `monitoringTelemetry/{deviceId}/points/{stableMeasurementId}` — размещённая
  точка с `measuredAt`, `receivedAt`, `sensorId`, temperature и двумя quality.
- `monitoringTelemetry/{deviceId}/unplacedPoints/{stableMeasurementId}` —
  точка без достоверного времени; не участвует в rollup или температурной
  статистике.
- `monitoringTelemetry/{deviceId}/rollups/{sensorId}__{hourStartMs}` — один
  часовой документ с раздельными `exact_realtime`, `exact_delayed`,
  `estimated_realtime`, `estimated_delayed` агрегатами и 5-минутными корзинами
  `count/sum/min/max`.

Overview не является траекторией температуры: будущий UI покажет каждой
5-минутной корзине диапазон min–max/маркер, а не линию по average. Смешанные
quality series не объединяются. Окно до 24 часов будет показывать только raw;
более 24 часов — только overview. Для overview-статистики полные корзины будут
дополняться raw точками только двух неполных границ диапазона.

`expireAt` уже записывается для будущей retention-политики (points и unplaced
35 дней, rollups 13 месяцев), но TTL не включён этой задачей и требует отдельной
настройки/подтверждения в Firestore Console.

При одном измерении раз в 30 секунд один датчик создаёт около 2 880 raw points
в сутки и 86 400 в 30 дней. За те же 30 дней overview читает около 720 часовых
rollup-документов (8 640 вложенных 5-минутных корзин), а не все raw points.
Каждая новая размещённая точка добавляет один point write и одно обновление
rollup; эти Firestore costs нужно подтвердить до production-публикации.

### Backfill: только после отдельного разрешения

`functions/scripts/backfill-monitoring-read-model.js` — доверенный Admin-tool,
не Cloud Function. По умолчанию он выполняет **dry-run**, не пишет в Firestore.
Для execute требуются `--execute`, ограничение `--max-packets` и throttling
`--rate-per-minute` (по умолчанию 30). После каждого успешно обработанного
packet сохраняется checkpoint
`monitoringMaintenance/telemetryReadModelBackfill/{deviceId}`; `--resume`
безопасно продолжает с последнего packet. Частично созданный read-модель packet
считает ошибкой, а не пытается угадать и рискнуть двойным count.

До отдельного подтверждения **не запускать** даже dry-run против production.
После такого подтверждения безопасная первая команда для `device-001`:

```powershell
npm --prefix functions run backfill:monitoring-read-model -- --project coolservice-crm --device-id device-001 --max-packets 100
```

После отдельно подтверждённого execute и завершения backfill сверка одного
UTC-дня обязательна. Она только читает Firestore и завершится с code 2 при
несовпадении N/min/max/avg legacy и новой модели:

```powershell
npm --prefix functions run verify:monitoring-read-model -- --project coolservice-crm --device-id device-001 --sensor-id temperature-1 --utc-day 2026-09-18
```

Для legacy пакетов без `sensorId` generic backfill нормализует `default`; для
единственного исторического датчика `device-001` он затем канонически
сопоставляет это значение с `temperature-1`. Это правило применяется только к
read-model backfill и не переписывает legacy `packets`.
Backfill не изменяет `packets`, `monitoringDeviceState`, alerts, credentials или
клиентские документы. Перед execute нужно опубликовать только согласованные
Function/Rules/indexes, затем выполнить dry-run, маленький rate-limited execute,
read-only сверку и лишь после неё продолжить `--resume`.

Повторный `packetId` или `statusId` не создаёт повторную запись. Отложенное
измерение попадает в историю, но не заменяет текущую температуру, если его
`measuredAt` старее уже известного показания.

## Подтверждения и журналы

- MQTT **PUBACK** подтверждает, что Mosquitto принял QoS 1 публикацию. Это не
  подтверждение доставки в CRM.
- Bridge сначала сохраняет валидное сообщение в SQLite, поэтому недоступная
  CRM не теряет уже принятые сообщения; HTTP выполняется вне MQTT callback.
- `HTTP 202` от `ingestTelemetry` означает: новый `packetId` записан.
  Публичный ответ: `outcome=stored`, `measurementsCreated > 0`.
- `HTTP 200` от `ingestTelemetry` означает: такой `packetId` уже был обработан;
  ответ содержит `outcome=duplicate`, `measurementsCreated=0`.
- Bridge журналирует только идентификатор и результат, например
  `CRM accepted packetId=… HTTP=202 outcome=stored created=1`. Старый
  успешный не-JSON ответ отмечается `outcome=unknown` и не останавливает bridge.

## Безопасная диагностика

1. На контроллере сначала различайте PUBACK, размер локальной очереди и
   `lastFailureCode`; не выводите ключ устройства.
2. На VPS смотрите только service journal и состояние SQLite/очереди, не
   печатая env-файл: `sudo journalctl -u crm-mqtt-bridge.service -n 100 --no-pager`.
3. Для `HTTP 202` ожидайте `outcome=stored`; для повторной доставки —
   `HTTP 200 outcome=duplicate`. `401` означает неверные/отозванные credentials
   и требует доверенной административной процедуры, а не публикации ключа.
4. В CRM проверяйте историю по **measuredAt**, а статус связи — по свежему
   controller status. Суточный график — скользящее окно 24 часов; более старые
   корректно сохранённые точки в него не входят.
5. Изменение bridge выполняйте только по
   [VPS README](../vps/crm-mqtt-bridge/README.md), с резервной копией файла и
   SQLite. Функцию `ingestTelemetry` следует опубликовать до нового bridge,
   чтобы журнал видел `stored`/`duplicate`.
