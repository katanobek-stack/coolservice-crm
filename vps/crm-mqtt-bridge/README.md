# Безопасное обновление crm-mqtt-bridge на VPS

Этот каталог — готовая самостоятельная версия bridge, потому что исходник
действующего bridge находится только на VPS и не был доступен для точного
патча. Она одновременно принимает прежний topic telemetry и новый status:

- `coolmonitor/devices/+/telemetry` → `CRM_TELEMETRY_URL`;
- `coolmonitor/devices/+/status` → `CRM_STATUS_URL`.

Оба topic принимаются c QoS 1. MQTT callback только проверяет и сохраняет
сообщение в SQLite; HTTPS выполняется отдельным worker-потоком. Ключи устройств
читаются только из VPS-файла, не попадают в SQLite, MQTT payload или journal.
HTTP 200/202 завершает доставку; 400/401 помечает её окончательно ошибочной;
остальные ошибки повторяются с backoff до 10 минут.

## Подготовка перед окном обновления

1. Убедитесь, что `ingestControllerStatus` уже опубликована и доступна по HTTPS.
   До этого status будут корректно сохраняться в SQLite и повторяться, но не
   смогут быть приняты CRM.
2. Сверьте на VPS реальное имя текущего service и пути. Команды ниже используют
   `crm-mqtt-bridge.service`, `/opt/crm-mqtt-bridge` и
   `/etc/crm-mqtt-bridge` как явные примеры, а не как скрытое предположение.
3. Сохраните текущие значения `CRM_TELEMETRY_URL`, MQTT host/TLS/login и
   существующий список ключей. Не выводите содержимое key-файла в терминал,
   journal или историю shell.

## Обновление на VPS

Выполняйте от привилегированного администратора, в согласованное окно:

```bash
sudo systemctl stop crm-mqtt-bridge
sudo install -d -o crm-mqtt-bridge -g crm-mqtt-bridge -m 0750 /opt/crm-mqtt-bridge /var/lib/crm-mqtt-bridge /etc/crm-mqtt-bridge
sudo cp -a /opt/crm-mqtt-bridge /opt/crm-mqtt-bridge.backup-$(date +%Y%m%d-%H%M%S)
```

Загрузите **без ключей** из этого каталога `crm_mqtt_bridge.py`,
`requirements.txt` и service unit в `/opt/crm-mqtt-bridge`. Затем создайте
venv и установите только указанную зависимость:

```bash
sudo python3 -m venv /opt/crm-mqtt-bridge/venv
sudo /opt/crm-mqtt-bridge/venv/bin/pip install -r /opt/crm-mqtt-bridge/requirements.txt
sudo chown -R crm-mqtt-bridge:crm-mqtt-bridge /opt/crm-mqtt-bridge /var/lib/crm-mqtt-bridge
sudo chmod 0750 /opt/crm-mqtt-bridge /var/lib/crm-mqtt-bridge
```

Создайте `/etc/crm-mqtt-bridge/bridge.env` с правами `0640 root:crm-mqtt-bridge`
на основе `crm-mqtt-bridge.env.example`. Сохраните существующий
`CRM_TELEMETRY_URL`; добавьте `CRM_STATUS_URL` с фактическим URL новой функции.
Ключи оставьте в отдельном `/etc/crm-mqtt-bridge/device-keys.json` c правами
`0640 root:crm-mqtt-bridge`, JSON-формат — `{ "device-001": "…" }`.

Проверка синтаксиса и импорт до restart (ключи при этом не печатаются):

```bash
sudo /opt/crm-mqtt-bridge/venv/bin/python -m py_compile /opt/crm-mqtt-bridge/crm_mqtt_bridge.py
sudo -u crm-mqtt-bridge /opt/crm-mqtt-bridge/venv/bin/python -c 'from crm_mqtt_bridge import Config, load_device_keys; c = Config.from_env(); load_device_keys(c.device_keys_file); print("configuration readable")'
```

Установите unit и перезапустите:

```bash
sudo install -m 0644 /opt/crm-mqtt-bridge/crm-mqtt-bridge.service /etc/systemd/system/crm-mqtt-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now crm-mqtt-bridge
sudo systemctl status crm-mqtt-bridge --no-pager
sudo journalctl -u crm-mqtt-bridge -n 100 --no-pager
```

В journal проверяйте только строки `mqtt connected`, `mqtt queued` и
`delivery accepted/retry/rejected` с `controllerId`, `messageId`, `httpCode`.
Ключей, Authorization, MQTT-паролей и payload в журнале быть не должно.

## Откат

Если telemetry перестала подтверждаться или service не запускается, остановите
service, верните содержимое последнего `/opt/crm-mqtt-bridge.backup-*`, затем
выполните `systemctl daemon-reload` и `systemctl start crm-mqtt-bridge`.
SQLite очередь не удаляйте: она содержит ожидающие delivery, но не ключи.
