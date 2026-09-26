# Сервисный монитор: MQTT-контракт

## Используемая инфраструктура

Сервисный монитор не создаёт отдельный MQTT broker. Он использует уже
работающий путь телеметрии:

~~~
ESP32/SIM800L -> Mosquitto VPS -> crm-mqtt-bridge (SQLite) -> HTTPS Cloud Functions -> Firestore -> CRM listener
~~~

crm-mqtt-bridge получает host, порт, login и password только из
/etc/crm-mqtt-bridge.env. Значения и device key не помещаются ни в
репозиторий, ни в MQTT payload, ни в логи. На текущем VPS MQTT работает по
обычному TCP на порту 1883, без TLS; это текущая конфигурация, а не новая
рекомендация по безопасности.

Bridge сохраняет сообщение в SQLite до HTTP-доставки. HTTP выполняется вне
Paho callback. Он сохраняет 32 delivery worker-а, recovery inflight-строк,
STATS и существующие coolmonitor/devices/+/telemetry и
coolmonitor/devices/+/status topics.

## Topics

Все сервисные публикации — QoS 1:

| Topic | Направление | Назначение |
| --- | --- | --- |
| service/{controllerId}/heartbeat | ESP32 -> CRM | Полная диагностика раз в 30–60 секунд |
| service/{controllerId}/log | ESP32 -> CRM | Одна строка live-лога |
| service/{controllerId}/status | ESP32 -> CRM | Retained online / Last Will offline |
| service/{controllerId}/command | CRM -> ESP32 | Только безопасная команда с commandId |
| service/{controllerId}/command/result | ESP32 -> CRM | Результат выполнения команды |

Контроллер должен использовать persistent MQTT session, автоматическое
переподключение и возрастающий backoff при потере GPRS. Его Last Will должен
быть retained QoS 1 сообщением в service/{controllerId}/status:

~~~json
{"controllerId":"device-001","statusId":"boot-17:offline","reportedAt":"2026-09-27T00:00:00Z","state":"offline"}
~~~

После успешного MQTT-подключения он публикует retained QoS 1 state: online.
Bridge не подменяет Last Will: он только подписывается, валидирует и
идемпотентно доставляет его в CRM.

## Payloads

Heartbeat (поле logs необязательно; основной live-лог идёт отдельным topic):

~~~json
{
  "controllerId":"device-001",
  "heartbeatId":"boot-17:42",
  "reportedAt":"2026-09-27T00:00:00Z",
  "ip":"10.0.0.24",
  "simSignal":21,
  "modemState":"ready",
  "gprsConnected":true,
  "firmwareVersion":"1.4.0",
  "uptimeSeconds":3600,
  "freeHeapBytes":120000,
  "flashBytes":4194304,
  "psramBytes":0,
  "resetReason":"power_on",
  "uartConnected":true
}
~~~

Live-лог:

~~~json
{"controllerId":"device-001","logId":"boot-17:43","reportedAt":"2026-09-27T00:00:02Z","level":"INFO","message":"TARGET << GPRS connected"}
~~~

Команда от bridge:

~~~json
{"controllerId":"device-001","commandId":"<server-id>","command":"SERVICE STATUS","requestedAt":"2026-09-27T00:00:04.000Z"}
~~~

Разрешены только SERVICE PING, SERVICE STATUS, SERVICE INFO. ESP32 обязан
дедуплицировать commandId и публиковать один result:

~~~json
{"controllerId":"device-001","commandId":"<server-id>","reportedAt":"2026-09-27T00:00:05Z","result":"ok","message":"status queued"}
~~~

RESET, GPIO0 и любые AT-команды не имеют MQTT-контракта и не принимаются
сервером.

## Server path and configuration

MQTT — основной путь: bridge переводит сервисные topics в Cloud Functions
ingestServiceControllerHeartbeat, ingestServiceControllerLog,
ingestServiceControllerStatus и ingestServiceControllerCommandResult.
Прежний HTTPS POST heartbeat остаётся допустимым резервным путём с тем же
Bearer device credential.

После публикации функций в существующий VPS env добавляются только URL и
необязательный идентификатор:

~~~
CRM_SERVICE_CONTROLLER_ID=device-001
CRM_SERVICE_HEARTBEAT_URL=<published heartbeat URL>
CRM_SERVICE_LOG_URL=<published log URL>
CRM_SERVICE_STATUS_URL=<published status URL>
CRM_SERVICE_COMMAND_RESULT_URL=<published command result URL>
CRM_SERVICE_COMMAND_CLAIM_URL=<published command claim URL>
CRM_SERVICE_COMMAND_DISPATCH_URL=<published command dispatch URL>
~~~

CRM_SERVICE_CONTROLLER_ID по умолчанию равен уже существующему CRM_DEVICE_ID.
Пока любой из шести URL отсутствует, service MQTT subscription на bridge
отключена, а температура и controller status продолжают работать как раньше.

Команды создаются callable-функцией только для manager/admin/owner. Bridge
периодически claim-ит одну команду и публикует её QoS 1. Claim автоматически
истекает через две минуты: после аварийного restart допускается повторная
доставка того же commandId, поэтому контроллер выполняет его идемпотентно.
