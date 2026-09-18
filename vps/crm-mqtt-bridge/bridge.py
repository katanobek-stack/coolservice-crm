#!/usr/bin/env python3
"""Durable MQTT-to-CRM bridge for the existing VPS service configuration.

The MQTT callback validates and commits into SQLite only. HTTPS delivery stays
in the main loop, so an unavailable CRM endpoint never blocks Paho's network
thread. Secrets come exclusively from /etc/crm-mqtt-bridge.env.
"""

import json
import logging
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt

LOG = logging.getLogger("crm_mqtt_bridge")
DATA_DIR = Path(os.environ.get("BRIDGE_DATA_DIR", "/var/lib/crm-mqtt-bridge"))
DB_PATH = DATA_DIR / "queue.sqlite3"

# Existing systemd EnvironmentFile variables. Do not rename these.
MQTT_HOST = os.environ["MQTT_HOST"]
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USERNAME = os.environ["MQTT_USERNAME"]
MQTT_PASSWORD = os.environ["MQTT_PASSWORD"]
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "coolmonitor/devices/+/telemetry")
CRM_URL = os.environ["CRM_URL"]
CRM_DEVICE_ID = os.environ["CRM_DEVICE_ID"]
CRM_DEVICE_KEY = os.environ["CRM_DEVICE_KEY"]

# The only new EnvironmentFile variable. It is a URL, not a secret.
CRM_STATUS_URL = os.environ["CRM_STATUS_URL"]
STATUS_TOPIC = "coolmonitor/devices/+/status"

REGISTRATION_STATES = {"home", "roaming", "searching", "denied", "unknown"}
FAILURE_CODES = {
    "none", "modem_not_ready", "network_not_registered", "ntp_sync_failed",
    "gprs_connect_failed", "tcp_connect_failed", "mqtt_connect_failed",
    "publish_send_failed", "puback_timeout", "modem_restarted", "esp_restarted",
}
STATUS_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
UTC_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$")


def database() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    migrate_queue_schema(db)
    return db


def table_columns(db: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def migrate_queue_schema(db: sqlite3.Connection) -> None:
    """Migrate old packet_id-only queues without dropping pending telemetry."""
    pending_columns = table_columns(db, "pending")
    rejected_columns = table_columns(db, "rejected")
    if pending_columns and "message_type" not in pending_columns:
        db.execute("BEGIN IMMEDIATE")
        try:
            if not rejected_columns:
                db.execute(
                    """CREATE TABLE rejected (
                    packet_id TEXT PRIMARY KEY, body TEXT NOT NULL,
                    rejected_at INTEGER NOT NULL, reason TEXT NOT NULL)"""
                )
            db.execute("ALTER TABLE pending RENAME TO pending_legacy")
            db.execute("ALTER TABLE rejected RENAME TO rejected_legacy")
            create_queue_tables(db)
            db.execute(
                """INSERT INTO pending(message_type, message_id, body, received_at, attempts, next_attempt_at, last_error)
                   SELECT 'telemetry', packet_id, body, received_at, attempts, next_attempt_at, last_error
                   FROM pending_legacy"""
            )
            db.execute(
                """INSERT INTO rejected(message_type, message_id, body, rejected_at, reason)
                   SELECT 'telemetry', packet_id, body, rejected_at, reason FROM rejected_legacy"""
            )
            db.execute("DROP TABLE pending_legacy")
            db.execute("DROP TABLE rejected_legacy")
            db.commit()
            LOG.info("SQLite queue migrated; existing telemetry retained")
        except Exception:
            db.rollback()
            raise
    else:
        create_queue_tables(db)


def create_queue_tables(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS pending (
          message_type TEXT NOT NULL CHECK(message_type IN ('telemetry', 'status')),
          message_id TEXT NOT NULL,
          body TEXT NOT NULL,
          received_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          PRIMARY KEY(message_type, message_id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS rejected (
          message_type TEXT NOT NULL CHECK(message_type IN ('telemetry', 'status')),
          message_id TEXT NOT NULL,
          body TEXT NOT NULL,
          rejected_at INTEGER NOT NULL,
          reason TEXT NOT NULL,
          PRIMARY KEY(message_type, message_id)
        )
        """
    )
    db.commit()


DB = database()
DB_LOCK = threading.Lock()


def telemetry_body(payload: Any, topic: str) -> tuple[str, str]:
    """Keep the working telemetry contract unchanged."""
    if not isinstance(payload, dict):
        raise ValueError("payload is not an object")
    controller_id = payload.get("controllerId")
    packet_id = payload.get("packetId")
    sensor_id = payload.get("sensorId")
    measured_at = payload.get("measuredAt")
    value = payload.get("value")
    expected_topic = f"coolmonitor/devices/{CRM_DEVICE_ID}/telemetry"
    if topic != expected_topic:
        raise ValueError("unexpected telemetry MQTT topic")
    if controller_id != CRM_DEVICE_ID:
        raise ValueError("unexpected telemetry controllerId")
    if not all(isinstance(item, str) and item for item in (packet_id, sensor_id, measured_at)):
        raise ValueError("missing packetId, sensorId, or measuredAt")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("value is not numeric")
    if value < -55 or value > 125:
        raise ValueError("temperature is outside DS18B20 range")
    body = {
        "deviceId": CRM_DEVICE_ID,
        "packetId": packet_id,
        "measurements": [{"measuredAt": measured_at, "temperatureC": value}],
    }
    return packet_id, json.dumps(body, separators=(",", ":"))


def status_body(payload: Any, topic: str) -> tuple[str, str]:
    """Validate the documented status contract without altering statusId."""
    required = {
        "controllerId", "statusId", "reportedAt", "networkRegistered", "registrationState", "rssi",
        "gprsConnected", "mqttConnected", "queueDepth", "lastFailureCode", "uptimeSeconds",
    }
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("invalid status fields")
    if topic != f"coolmonitor/devices/{CRM_DEVICE_ID}/status":
        raise ValueError("unexpected status MQTT topic")
    if payload["controllerId"] != CRM_DEVICE_ID:
        raise ValueError("unexpected status controllerId")
    status_id = payload["statusId"]
    if not isinstance(status_id, str) or not STATUS_ID_RE.fullmatch(status_id):
        raise ValueError("invalid statusId")
    reported_at = payload["reportedAt"]
    if not isinstance(reported_at, str) or not UTC_ISO_RE.fullmatch(reported_at):
        raise ValueError("invalid reportedAt")
    try:
        datetime.fromisoformat(reported_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("invalid reportedAt") from error
    if not isinstance(payload["networkRegistered"], bool):
        raise ValueError("invalid networkRegistered")
    if payload["registrationState"] not in REGISTRATION_STATES:
        raise ValueError("invalid registrationState")
    rssi = payload["rssi"]
    if rssi is not None and (type(rssi) is not int or not 0 <= rssi <= 31):
        raise ValueError("invalid rssi")
    if not isinstance(payload["gprsConnected"], bool) or not isinstance(payload["mqttConnected"], bool):
        raise ValueError("invalid connection state")
    if type(payload["queueDepth"]) is not int or payload["queueDepth"] < 0:
        raise ValueError("invalid queueDepth")
    if payload["lastFailureCode"] not in FAILURE_CODES:
        raise ValueError("invalid lastFailureCode")
    if type(payload["uptimeSeconds"]) is not int or payload["uptimeSeconds"] < 0:
        raise ValueError("invalid uptimeSeconds")
    return status_id, json.dumps(payload, separators=(",", ":"))


def enqueue(message_type: str, message_id: str, body: str) -> None:
    with DB_LOCK:
        DB.execute(
            "INSERT OR IGNORE INTO pending(message_type, message_id, body, received_at) VALUES (?, ?, ?, ?)",
            (message_type, message_id, body, int(time.time())),
        )
        DB.commit()


def target_url(message_type: str) -> str:
    return CRM_URL if message_type == "telemetry" else CRM_STATUS_URL


def telemetry_delivery_result(body: bytes) -> tuple[str, int | None]:
    """Read the optional public ingestTelemetry result without exposing payloads."""
    try:
        result = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "unknown", None
    if not isinstance(result, dict) or result.get("outcome") not in {"stored", "duplicate"}:
        return "unknown", None
    created = result.get("measurementsCreated")
    if type(created) is not int or created < 0:
        return "unknown", None
    return result["outcome"], created


def deliver_one() -> None:
    with DB_LOCK:
        row = DB.execute(
            "SELECT message_type, message_id, body, attempts FROM pending WHERE next_attempt_at <= ? "
            "ORDER BY received_at LIMIT 1", (int(time.time()),)
        ).fetchone()
    if row is None:
        return
    message_type, message_id, body, attempts = row
    request = urllib.request.Request(
        target_url(message_type), data=body.encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {CRM_DEVICE_KEY}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            status = response.status
            response_body = response.read()
        if status not in (200, 202):
            raise RuntimeError(f"unexpected HTTP {status}")
        with DB_LOCK:
            DB.execute("DELETE FROM pending WHERE message_type = ? AND message_id = ?", (message_type, message_id))
            DB.commit()
        if message_type == "telemetry":
            telemetry_outcome, created = telemetry_delivery_result(response_body)
            log_delivery("accepted", message_type, message_id, status, telemetry_outcome, created)
        else:
            log_delivery("accepted", message_type, message_id, status)
    except urllib.error.HTTPError as error:
        if 400 <= error.code < 500 and error.code not in (408, 429):
            reject(message_type, message_id, body, f"CRM HTTP {error.code}")
            log_delivery("rejected", message_type, message_id, error.code, level=logging.ERROR)
            return
        retry(message_type, message_id, attempts, f"CRM HTTP {error.code}")
    except Exception as error:
        retry(message_type, message_id, attempts, str(error))


def log_delivery(
    outcome: str,
    message_type: str,
    message_id: str,
    status: int | None,
    telemetry_outcome: str | None = None,
    created: int | None = None,
    level: int = logging.INFO,
) -> None:
    if message_type == "status":
        LOG.log(level, "CRM %s controllerId=%s statusId=%s HTTP=%s", outcome, CRM_DEVICE_ID, message_id, status)
    else:
        if telemetry_outcome in {"stored", "duplicate"} and created is not None:
            LOG.log(
                level,
                "CRM %s packetId=%s HTTP=%s outcome=%s created=%s",
                outcome,
                message_id,
                status,
                telemetry_outcome,
                created,
            )
        else:
            LOG.log(level, "CRM %s packetId=%s HTTP=%s outcome=unknown", outcome, message_id, status)


def reject(message_type: str, message_id: str, body: str, reason: str) -> None:
    with DB_LOCK:
        DB.execute(
            "INSERT OR REPLACE INTO rejected(message_type, message_id, body, rejected_at, reason) VALUES (?, ?, ?, ?, ?)",
            (message_type, message_id, body, int(time.time()), reason),
        )
        DB.execute("DELETE FROM pending WHERE message_type = ? AND message_id = ?", (message_type, message_id))
        DB.commit()


def retry(message_type: str, message_id: str, attempts: int, reason: str) -> None:
    delay = min(300, max(5, 2 ** min(attempts + 1, 8)))
    with DB_LOCK:
        DB.execute(
            "UPDATE pending SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE message_type = ? AND message_id = ?",
            (attempts + 1, int(time.time()) + delay, reason[:300], message_type, message_id),
        )
        DB.commit()
    if message_type == "status":
        LOG.warning("CRM delivery deferred controllerId=%s statusId=%s in %ss", CRM_DEVICE_ID, message_id, delay)
    else:
        LOG.warning("CRM delivery deferred packetId=%s in %ss", message_id, delay)


def on_connect(client: mqtt.Client, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any = None) -> None:
    if int(reason_code) != 0:
        LOG.error("MQTT connection refused: %s", reason_code)
        return
    client.subscribe(MQTT_TOPIC, qos=1)
    client.subscribe(STATUS_TOPIC, qos=1)
    LOG.info("MQTT connected; subscribed to %s and %s", MQTT_TOPIC, STATUS_TOPIC)


def on_message(_client: mqtt.Client, _userdata: Any, message: mqtt.MQTTMessage) -> None:
    try:
        payload = json.loads(message.payload.decode("utf-8"))
        if message.topic == f"coolmonitor/devices/{CRM_DEVICE_ID}/telemetry":
            message_id, body = telemetry_body(payload, message.topic)
            message_type = "telemetry"
        elif message.topic == f"coolmonitor/devices/{CRM_DEVICE_ID}/status":
            message_id, body = status_body(payload, message.topic)
            message_type = "status"
        else:
            raise ValueError("unexpected MQTT topic")
        enqueue(message_type, message_id, body)
        if message_type == "status":
            LOG.info("MQTT queued controllerId=%s statusId=%s", CRM_DEVICE_ID, message_id)
        else:
            LOG.info("MQTT queued packetId=%s", message_id)
    except Exception as error:
        LOG.error("MQTT message rejected: %s", error)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = mqtt.Client(client_id="crm-mqtt-bridge-v1", clean_session=False)
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=2, max_delay=60)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_start()
    while True:
        deliver_one()
        time.sleep(1)


if __name__ == "__main__":
    main()
