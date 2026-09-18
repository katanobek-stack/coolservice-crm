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
  "timeQuality": "exact"
}
```

Bridge проверяет topic и `controllerId`, затем преобразует это в неизменяемый
контракт `ingestTelemetry`: `deviceId`, `packetId` и массив
`measurements[{ measuredAt, temperatureC, timeQuality }]`.

`timeQuality` допускает только `exact` и `estimated`. Поле необязательно для
старых MQTT- и HTTP-пакетов: его отсутствие на bridge и в `ingestTelemetry`
трактуется как `exact`. `estimated` означает, что контроллер восстановил время
после отсутствия UTC; температура остаётся реальной, оценочным является только
время измерения. CRM показывает такие точки оранжевыми с пунктиром и не
соединяет их синей линией с точными участками.

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
  измерений.
- Последняя температура: `monitoringDeviceState/{deviceId}`.
- Последний status: `monitoringControllerStatus/{controllerId}`; события status
  отдельно в `monitoringControllerStatus/{controllerId}/statusEvents/{statusId}`.

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
