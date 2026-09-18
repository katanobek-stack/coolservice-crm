# Обновление реального crm-mqtt-bridge на VPS

`bridge.py` основан на работающем bridge. Он сохраняет его telemetry contract,
current systemd service и environment names, добавляя только status topic и
`CRM_STATUS_URL`.

- telemetry: `coolmonitor/devices/+/telemetry` → `CRM_URL`;
- status: `coolmonitor/devices/+/status` → `CRM_STATUS_URL`.

MQTT остаётся обычным TCP на текущем `MQTT_PORT` (1883), без TLS. HTTP выполняет
основной delivery loop, а callback только валидирует и сохраняет запись в
SQLite. Ключ берётся только из существующего `CRM_DEVICE_KEY` и не попадает в
логи. Очередь мигрирует атомарно: старые `pending(packet_id, …)` и `rejected`
копируются как `telemetry` в таблицы с ключом `(message_type, message_id)`.

## Обновление

На VPS выполните в согласованное окно. `STAMP` понадобится также для rollback:

```bash
sudo systemctl stop crm-mqtt-bridge.service
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp -a /opt/crm-mqtt-bridge/bridge.py /opt/crm-mqtt-bridge/bridge.py.pre-status-$STAMP
sudo cp -a /var/lib/crm-mqtt-bridge /var/lib/crm-mqtt-bridge.pre-status-$STAMP
```

Загрузите **только** этот repo-файл как
`/opt/crm-mqtt-bridge/bridge.py`. Не загружайте `current-bridge.py`: это
локальная исходная копия для сравнения, а не deploy-файл.

В существующем `/etc/crm-mqtt-bridge.env` добавьте одну строку с опубликованным
HTTPS URL функции, сохранив все текущие имена и значения:

```text
CRM_STATUS_URL=https://europe-west1-coolservice-crm.cloudfunctions.net/ingestControllerStatus
```

Проверьте синтаксис и перезапустите существующий service:

```bash
sudo -u crmbridge /usr/bin/python3 -m py_compile /opt/crm-mqtt-bridge/bridge.py
sudo systemctl start crm-mqtt-bridge.service
sudo systemctl status crm-mqtt-bridge.service --no-pager
sudo journalctl -u crm-mqtt-bridge.service -n 100 --no-pager
```

В journal ожидаются подписки на оба topic. Для telemetry успешная запись имеет
вид `CRM accepted packetId=… HTTP=202 outcome=stored created=1`; повтор будет
`HTTP=200 outcome=duplicate created=0`. Старый успешный не-JSON ответ безопасно
показывается как `outcome=unknown`. Для status журналируются только
`controllerId`, `statusId` и HTTP status; ключ, MQTT password и payload не
выводятся. Сначала убедитесь, что telemetry продолжает получать HTTP 200/202,
затем включайте публикацию status на контроллере.

## Rollback

Если service не запускается или telemetry не доставляется, остановите его,
верните **и файл, и SQLite directory** из одного pre-status backup — старый
bridge не понимает мигрированную схему:

```bash
sudo systemctl stop crm-mqtt-bridge.service
sudo cp -a /opt/crm-mqtt-bridge/bridge.py.pre-status-$STAMP /opt/crm-mqtt-bridge/bridge.py
sudo mv /var/lib/crm-mqtt-bridge /var/lib/crm-mqtt-bridge.status-migrated-$STAMP
sudo cp -a /var/lib/crm-mqtt-bridge.pre-status-$STAMP /var/lib/crm-mqtt-bridge
sudo systemctl start crm-mqtt-bridge.service
sudo journalctl -u crm-mqtt-bridge.service -n 100 --no-pager
```

Не удаляйте `status-migrated` directory до расследования: он содержит очередь,
включая сообщения, принятые после миграции.
