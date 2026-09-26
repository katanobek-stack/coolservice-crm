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

# Service Monitor uses the same Mosquitto client, broker credentials and
# SQLite queue. It is deliberately disabled until every non-secret endpoint
# URL has been configured, so installing this file cannot interrupt telemetry.
SERVICE_CONTROLLER_ID = os.environ.get("CRM_SERVICE_CONTROLLER_ID", CRM_DEVICE_ID)
SERVICE_HEARTBEAT_URL = os.environ.get("CRM_SERVICE_HEARTBEAT_URL", "")
SERVICE_LOG_URL = os.environ.get("CRM_SERVICE_LOG_URL", "")
SERVICE_STATUS_URL = os.environ.get("CRM_SERVICE_STATUS_URL", "")
SERVICE_COMMAND_RESULT_URL = os.environ.get("CRM_SERVICE_COMMAND_RESULT_URL", "")
SERVICE_COMMAND_CLAIM_URL = os.environ.get("CRM_SERVICE_COMMAND_CLAIM_URL", "")
SERVICE_COMMAND_DISPATCH_URL = os.environ.get("CRM_SERVICE_COMMAND_DISPATCH_URL", "")
SERVICE_ENDPOINTS = (
    SERVICE_HEARTBEAT_URL, SERVICE_LOG_URL, SERVICE_STATUS_URL,
    SERVICE_COMMAND_RESULT_URL, SERVICE_COMMAND_CLAIM_URL, SERVICE_COMMAND_DISPATCH_URL,
)
SERVICE_MQTT_ENABLED = all(SERVICE_ENDPOINTS)
SERVICE_HEARTBEAT_TOPIC = "service/+/heartbeat"
SERVICE_LOG_TOPIC = "service/+/log"
SERVICE_STATUS_TOPIC = "service/+/status"
SERVICE_COMMAND_RESULT_TOPIC = "service/+/command/result"
SERVICE_COMMAND_TOPIC = f"service/{SERVICE_CONTROLLER_ID}/command"
SERVICE_COMMAND_POLL_SECONDS = max(2, min(60, int(os.environ.get("CRM_SERVICE_COMMAND_POLL_SECONDS", "5"))))
SERVICE_MESSAGE_TYPES = {
    "service_heartbeat", "service_log", "service_status", "service_command_result",
}
SERVICE_COMMANDS = {"SERVICE PING", "SERVICE STATUS", "SERVICE INFO"}

# HTTPS is the slow part of the pipeline, not MQTT or SQLite. Thirty-two
# independent workers keep recovery traffic from blocking fresh telemetry.
# It can be lowered on the VPS through CRM_DELIVERY_WORKERS without a code edit.
try:
    DELIVERY_WORKERS = max(1, min(64, int(os.environ.get("CRM_DELIVERY_WORKERS", "32"))))
except ValueError:
    DELIVERY_WORKERS = 32
STATS_INTERVAL_SECONDS = 30

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
    prepare_delivery_claims(db)
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
    migrate_queue_message_types(db)


def migrate_queue_message_types(db: sqlite3.Connection) -> None:
    """Widen the old SQLite CHECK without discarding pending telemetry/status."""
    pending_sql = (db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pending'"
    ).fetchone() or [""])[0] or ""
    if "service_heartbeat" in pending_sql:
        return
    columns = table_columns(db, "pending")
    rejected_columns = table_columns(db, "rejected")
    # Ensure these fields exist before copying an older post-status queue.
    if "delivery_state" not in columns:
        db.execute("ALTER TABLE pending ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'pending'")
    if "claimed_at" not in columns:
        db.execute("ALTER TABLE pending ADD COLUMN claimed_at INTEGER")
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("ALTER TABLE pending RENAME TO pending_before_service")
        if rejected_columns:
            db.execute("ALTER TABLE rejected RENAME TO rejected_before_service")
        create_queue_tables(db, commit=False)
        db.execute(
            """INSERT INTO pending(message_type, message_id, body, received_at, attempts, next_attempt_at, last_error, delivery_state, claimed_at)
               SELECT message_type, message_id, body, received_at, attempts, next_attempt_at, last_error,
                      COALESCE(delivery_state, 'pending'), claimed_at
               FROM pending_before_service"""
        )
        if rejected_columns:
            db.execute(
                """INSERT INTO rejected(message_type, message_id, body, rejected_at, reason)
                   SELECT message_type, message_id, body, rejected_at, reason FROM rejected_before_service"""
            )
            db.execute("DROP TABLE rejected_before_service")
        db.execute("DROP TABLE pending_before_service")
        db.commit()
        LOG.info("SQLite queue migrated; pending telemetry/status retained for service topics")
    except Exception:
        db.rollback()
        raise


def create_queue_tables(db: sqlite3.Connection, commit: bool = True) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS pending (
          message_type TEXT NOT NULL,
          message_id TEXT NOT NULL,
          body TEXT NOT NULL,
          received_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending', 'inflight')),
          claimed_at INTEGER,
          PRIMARY KEY(message_type, message_id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS rejected (
          message_type TEXT NOT NULL,
          message_id TEXT NOT NULL,
          body TEXT NOT NULL,
          rejected_at INTEGER NOT NULL,
          reason TEXT NOT NULL,
          PRIMARY KEY(message_type, message_id)
        )
        """
    )
    if commit:
        db.commit()


def prepare_delivery_claims(db: sqlite3.Connection) -> None:
    """Add durable worker-claim fields without dropping existing telemetry."""
    columns = table_columns(db, "pending")
    if "delivery_state" not in columns:
        db.execute("ALTER TABLE pending ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'pending'")
    if "claimed_at" not in columns:
        db.execute("ALTER TABLE pending ADD COLUMN claimed_at INTEGER")
    # A process may stop while HTTPS is in flight. Its row was never deleted,
    # so it is safe and necessary to make it available after service restart.
    db.execute("UPDATE pending SET delivery_state = 'pending', claimed_at = NULL WHERE delivery_state = 'inflight'")
    db.execute(
        "CREATE INDEX IF NOT EXISTS pending_delivery_ready "
        "ON pending(delivery_state, next_attempt_at, received_at)"
    )
    db.commit()


DB = database()
DB_LOCK = threading.Lock()
STATS_LOCK = threading.Lock()
delivery_stats = {"accepted": 0, "rejected": 0, "deferred": 0}


def telemetry_body(payload: Any, topic: str) -> tuple[str, str]:
    """Keep the working telemetry contract unchanged."""
    if not isinstance(payload, dict):
        raise ValueError("payload is not an object")
    controller_id = payload.get("controllerId")
    packet_id = payload.get("packetId")
    sensor_id = payload.get("sensorId")
    measured_at = payload.get("measuredAt")
    value = payload.get("value")
    time_quality = payload.get("timeQuality")
    delivery_quality = payload.get("deliveryQuality")
    expected_topic = f"coolmonitor/devices/{CRM_DEVICE_ID}/telemetry"
    if topic != expected_topic:
        raise ValueError("unexpected telemetry MQTT topic")
    if controller_id != CRM_DEVICE_ID:
        raise ValueError("unexpected telemetry controllerId")
    if not all(isinstance(item, str) and item for item in (packet_id, sensor_id)):
        raise ValueError("missing packetId or sensorId")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("value is not numeric")
    if time_quality is not None and time_quality not in {"exact", "estimated", "unplaced"}:
        raise ValueError("timeQuality must be exact, estimated, or unplaced")
    if delivery_quality is not None and delivery_quality not in {"realtime", "delayed"}:
        raise ValueError("deliveryQuality must be realtime or delayed")
    if value < -55 or value > 125:
        raise ValueError("temperature is outside DS18B20 range")
    if time_quality == "unplaced":
        if "measuredAt" in payload:
            raise ValueError("unplaced telemetry must omit measuredAt")
        measurement = {"temperatureC": value, "sensorId": sensor_id, "timeQuality": "unplaced"}
    else:
        if not isinstance(measured_at, str) or not measured_at:
            raise ValueError("missing measuredAt")
        measurement = {"measuredAt": measured_at, "temperatureC": value, "sensorId": sensor_id}
    if time_quality is not None:
        measurement["timeQuality"] = time_quality
    if delivery_quality is not None:
        measurement["deliveryQuality"] = delivery_quality
    body = {
        "deviceId": CRM_DEVICE_ID,
        "packetId": packet_id,
        "measurements": [measurement],
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


def service_topic_controller_id(topic: str, suffix: str) -> str:
    parts = topic.split("/")
    expected = ["service", SERVICE_CONTROLLER_ID, *suffix.split("/")]
    if parts != expected:
        raise ValueError("unexpected service MQTT topic")
    return SERVICE_CONTROLLER_ID


def service_heartbeat_body(payload: Any, topic: str) -> tuple[str, str]:
    service_topic_controller_id(topic, "heartbeat")
    required = {
        "controllerId", "heartbeatId", "reportedAt", "ip", "simSignal", "modemState",
        "gprsConnected", "firmwareVersion", "uptimeSeconds", "freeHeapBytes", "flashBytes",
        "psramBytes", "resetReason", "uartConnected",
    }
    optional = {"logs"}
    if not isinstance(payload, dict) or not required.issubset(payload) or not set(payload).issubset(required | optional):
        raise ValueError("invalid service heartbeat fields")
    if payload["controllerId"] != SERVICE_CONTROLLER_ID:
        raise ValueError("unexpected service controllerId")
    heartbeat_id = payload["heartbeatId"]
    if not isinstance(heartbeat_id, str) or not STATUS_ID_RE.fullmatch(heartbeat_id):
        raise ValueError("invalid heartbeatId")
    if not isinstance(payload["reportedAt"], str) or not UTC_ISO_RE.fullmatch(payload["reportedAt"]):
        raise ValueError("invalid reportedAt")
    if payload["ip"] is not None and (not isinstance(payload["ip"], str) or len(payload["ip"]) > 64):
        raise ValueError("invalid ip")
    signal = payload["simSignal"]
    if signal is not None and (type(signal) is not int or not 0 <= signal <= 31):
        raise ValueError("invalid simSignal")
    if not isinstance(payload["modemState"], str) or not payload["modemState"] or len(payload["modemState"]) > 80:
        raise ValueError("invalid modemState")
    if not isinstance(payload["firmwareVersion"], str) or not payload["firmwareVersion"] or len(payload["firmwareVersion"]) > 120:
        raise ValueError("invalid firmwareVersion")
    if not isinstance(payload["gprsConnected"], bool) or not isinstance(payload["uartConnected"], bool):
        raise ValueError("invalid service connection state")
    for field in ("uptimeSeconds", "freeHeapBytes", "flashBytes", "psramBytes"):
        if type(payload[field]) is not int or payload[field] < 0:
            raise ValueError(f"invalid {field}")
    if not isinstance(payload["resetReason"], str) or not payload["resetReason"] or len(payload["resetReason"]) > 120:
        raise ValueError("invalid resetReason")
    logs = payload.get("logs", [])
    if not isinstance(logs, list) or len(logs) > 40:
        raise ValueError("invalid logs")
    return heartbeat_id, json.dumps(payload, separators=(",", ":"))


def service_log_body(payload: Any, topic: str) -> tuple[str, str]:
    service_topic_controller_id(topic, "log")
    required = {"controllerId", "logId", "reportedAt", "level", "message"}
    if not isinstance(payload, dict) or set(payload) != required or payload["controllerId"] != SERVICE_CONTROLLER_ID:
        raise ValueError("invalid service log fields")
    log_id = payload["logId"]
    if not isinstance(log_id, str) or not STATUS_ID_RE.fullmatch(log_id):
        raise ValueError("invalid logId")
    if not isinstance(payload["reportedAt"], str) or not UTC_ISO_RE.fullmatch(payload["reportedAt"]):
        raise ValueError("invalid reportedAt")
    if payload["level"] not in {"ERROR", "WARN", "INFO"}:
        raise ValueError("invalid log level")
    if not isinstance(payload["message"], str) or not payload["message"].strip() or len(payload["message"]) > 600:
        raise ValueError("invalid log message")
    return log_id, json.dumps(payload, separators=(",", ":"))


def service_status_body(payload: Any, topic: str) -> tuple[str, str]:
    service_topic_controller_id(topic, "status")
    required = {"controllerId", "statusId", "reportedAt", "state"}
    if not isinstance(payload, dict) or set(payload) != required or payload["controllerId"] != SERVICE_CONTROLLER_ID:
        raise ValueError("invalid service status fields")
    status_id = payload["statusId"]
    if not isinstance(status_id, str) or not STATUS_ID_RE.fullmatch(status_id):
        raise ValueError("invalid service statusId")
    if not isinstance(payload["reportedAt"], str) or not UTC_ISO_RE.fullmatch(payload["reportedAt"]):
        raise ValueError("invalid reportedAt")
    if payload["state"] not in {"online", "offline"}:
        raise ValueError("invalid service state")
    return status_id, json.dumps(payload, separators=(",", ":"))


def service_command_result_body(payload: Any, topic: str) -> tuple[str, str]:
    service_topic_controller_id(topic, "command/result")
    required = {"controllerId", "commandId", "reportedAt", "result", "message"}
    if not isinstance(payload, dict) or set(payload) != required or payload["controllerId"] != SERVICE_CONTROLLER_ID:
        raise ValueError("invalid service command result fields")
    command_id = payload["commandId"]
    if not isinstance(command_id, str) or not STATUS_ID_RE.fullmatch(command_id):
        raise ValueError("invalid commandId")
    if not isinstance(payload["reportedAt"], str) or not UTC_ISO_RE.fullmatch(payload["reportedAt"]):
        raise ValueError("invalid reportedAt")
    if payload["result"] not in {"ok", "error"}:
        raise ValueError("invalid command result")
    if not isinstance(payload["message"], str) or not payload["message"].strip() or len(payload["message"]) > 600:
        raise ValueError("invalid command message")
    return command_id, json.dumps(payload, separators=(",", ":"))


def enqueue(message_type: str, message_id: str, body: str) -> None:
    with DB_LOCK:
        DB.execute(
            "INSERT OR IGNORE INTO pending(message_type, message_id, body, received_at) VALUES (?, ?, ?, ?)",
            (message_type, message_id, body, int(time.time())),
        )
        DB.commit()


def target_url(message_type: str) -> str:
    urls = {
        "telemetry": CRM_URL,
        "status": CRM_STATUS_URL,
        "service_heartbeat": SERVICE_HEARTBEAT_URL,
        "service_log": SERVICE_LOG_URL,
        "service_status": SERVICE_STATUS_URL,
        "service_command_result": SERVICE_COMMAND_RESULT_URL,
    }
    return urls[message_type]


def telemetry_delivery_result(body: bytes) -> tuple[str, int | None]:
    """Read the public successful telemetry result without exposing the response body."""
    try:
        result = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "unknown", None
    if not isinstance(result, dict) or result.get("outcome") not in {"stored", "duplicate"}:
        return "unknown", None
    created = result.get("measurementsCreated")
    if type(created) is not int or created < 0:
        return "unknown", None
    if result["outcome"] == "duplicate" and created != 0:
        return "unknown", None
    return result["outcome"], created


def count_delivery(outcome: str) -> None:
    with STATS_LOCK:
        delivery_stats[outcome] += 1


def claim_next_delivery() -> tuple[str, str, str, int] | None:
    """Atomically reserve exactly one ready row for one HTTP worker."""
    with DB_LOCK:
        row = DB.execute(
            "SELECT message_type, message_id, body, attempts FROM pending "
            "WHERE delivery_state = 'pending' AND next_attempt_at <= ? "
            "ORDER BY received_at LIMIT 1", (int(time.time()),)
        ).fetchone()
        if row is None:
            return None
        message_type, message_id, body, attempts = row
        updated = DB.execute(
            "UPDATE pending SET delivery_state = 'inflight', claimed_at = ? "
            "WHERE message_type = ? AND message_id = ? AND delivery_state = 'pending'",
            (int(time.time()), message_type, message_id),
        )
        DB.commit()
        if updated.rowcount != 1:
            return None
    return message_type, message_id, body, attempts


def deliver_claimed(message_type: str, message_id: str, body: str, attempts: int) -> None:
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
        count_delivery("accepted")
        if message_type == "telemetry":
            telemetry_outcome, created = telemetry_delivery_result(response_body)
            log_delivery("accepted", message_type, message_id, status, telemetry_outcome, created)
        else:
            log_delivery("accepted", message_type, message_id, status)
    except urllib.error.HTTPError as error:
        if 400 <= error.code < 500 and error.code not in (408, 429):
            reject(message_type, message_id, body, f"CRM HTTP {error.code}")
            count_delivery("rejected")
            log_delivery("rejected", message_type, message_id, error.code, logging.ERROR)
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
    elif message_type in SERVICE_MESSAGE_TYPES:
        LOG.log(level, "CRM %s serviceControllerId=%s messageType=%s messageId=%s HTTP=%s",
                outcome, SERVICE_CONTROLLER_ID, message_type, message_id, status)
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
        elif telemetry_outcome == "unknown":
            LOG.log(level, "CRM %s packetId=%s HTTP=%s outcome=unknown", outcome, message_id, status)
        else:
            LOG.log(level, "CRM %s packetId=%s HTTP=%s", outcome, message_id, status)


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
            "UPDATE pending SET attempts = ?, next_attempt_at = ?, last_error = ?, "
            "delivery_state = 'pending', claimed_at = NULL WHERE message_type = ? AND message_id = ?",
            (attempts + 1, int(time.time()) + delay, reason[:300], message_type, message_id),
        )
        DB.commit()
    count_delivery("deferred")
    if message_type == "status":
        LOG.warning("CRM delivery deferred controllerId=%s statusId=%s in %ss", CRM_DEVICE_ID, message_id, delay)
    elif message_type in SERVICE_MESSAGE_TYPES:
        LOG.warning(
            "CRM service delivery deferred controllerId=%s messageType=%s messageId=%s in %ss",
            SERVICE_CONTROLLER_ID, message_type, message_id, delay,
        )
    else:
        LOG.warning("CRM delivery deferred packetId=%s in %ss", message_id, delay)


def delivery_worker(worker_number: int) -> None:
    while True:
        claimed = claim_next_delivery()
        if claimed is None:
            time.sleep(0.05)
            continue
        try:
            deliver_claimed(*claimed)
        except Exception:
            # Do not strand a claimed row if a programming or encoding error
            # occurs before the normal HTTP exception handling path.
            message_type, message_id, _body, attempts = claimed
            LOG.exception("delivery worker=%d crashed while handling messageId=%s", worker_number, message_id)
            retry(message_type, message_id, attempts, "unexpected worker exception")


def queue_stats() -> tuple[int, int, int | None]:
    with DB_LOCK:
        pending, inflight, oldest = DB.execute(
            "SELECT "
            "SUM(CASE WHEN delivery_state = 'pending' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN delivery_state = 'inflight' THEN 1 ELSE 0 END), "
            "MIN(received_at) FROM pending"
        ).fetchone()
    return int(pending or 0), int(inflight or 0), oldest


def stats_reporter() -> None:
    while True:
        time.sleep(STATS_INTERVAL_SECONDS)
        pending, inflight, oldest = queue_stats()
        with STATS_LOCK:
            accepted = delivery_stats["accepted"]
            rejected = delivery_stats["rejected"]
            deferred = delivery_stats["deferred"]
            delivery_stats.update(accepted=0, rejected=0, deferred=0)
        oldest_waiting = max(0, int(time.time()) - oldest) if oldest else 0
        LOG.info(
            "STATS workers=%d pending=%d inFlight=%d acceptedLast30s=%d "
            "rejectedLast30s=%d deferredLast30s=%d rate=%.2f/s oldestWaiting=%ss",
            DELIVERY_WORKERS, pending, inflight, accepted, rejected, deferred,
            accepted / STATS_INTERVAL_SECONDS, oldest_waiting,
        )


def service_request(url: str, body: dict[str, Any]) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url, data=json.dumps(body, separators=(",", ":")).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {CRM_DEVICE_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.status, response.read()


def service_command_poller(client: mqtt.Client) -> None:
    """Pull one server-validated command and publish it with MQTT QoS 1."""
    while True:
        time.sleep(SERVICE_COMMAND_POLL_SECONDS)
        try:
            status, body = service_request(SERVICE_COMMAND_CLAIM_URL, {"controllerId": SERVICE_CONTROLLER_ID})
            if status == 204:
                continue
            if status != 200:
                LOG.warning("CRM service command claim HTTP=%s", status)
                continue
            command = json.loads(body.decode("utf-8"))
            if (
                not isinstance(command, dict)
                or not isinstance(command.get("commandId"), str)
                or command.get("command") not in SERVICE_COMMANDS
                or command.get("controllerId") != SERVICE_CONTROLLER_ID
            ):
                LOG.error("CRM service command claim rejected: invalid response")
                continue
            payload = {
                "controllerId": SERVICE_CONTROLLER_ID,
                "commandId": command["commandId"],
                "command": command["command"],
                "requestedAt": command.get("requestedAt"),
            }
            info = client.publish(SERVICE_COMMAND_TOPIC, json.dumps(payload, separators=(",", ":")), qos=1, retain=False)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                LOG.warning("MQTT service command deferred commandId=%s rc=%s", command["commandId"], info.rc)
                continue
            info.wait_for_publish(timeout=15)
            if not info.is_published():
                LOG.warning("MQTT service command PUBACK timeout commandId=%s", command["commandId"])
                continue
            dispatched_status, _ = service_request(
                SERVICE_COMMAND_DISPATCH_URL,
                {"controllerId": SERVICE_CONTROLLER_ID, "commandId": command["commandId"]},
            )
            if dispatched_status not in (200, 202):
                LOG.warning("CRM service command dispatch acknowledgement HTTP=%s commandId=%s", dispatched_status, command["commandId"])
                continue
            LOG.info("MQTT service command published controllerId=%s commandId=%s command=%s",
                     SERVICE_CONTROLLER_ID, command["commandId"], command["command"])
        except urllib.error.HTTPError as error:
            if error.code != 204:
                LOG.warning("CRM service command poll HTTP=%s", error.code)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            LOG.warning("CRM service command poll rejected: %s", error)
        except Exception as error:
            LOG.warning("CRM service command poll deferred: %s", error)


def on_connect(client: mqtt.Client, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any = None) -> None:
    if int(reason_code) != 0:
        LOG.error("MQTT connection refused: %s", reason_code)
        return
    client.subscribe(MQTT_TOPIC, qos=1)
    client.subscribe(STATUS_TOPIC, qos=1)
    if SERVICE_MQTT_ENABLED:
        for topic in (SERVICE_HEARTBEAT_TOPIC, SERVICE_LOG_TOPIC, SERVICE_STATUS_TOPIC, SERVICE_COMMAND_RESULT_TOPIC):
            client.subscribe(topic, qos=1)
        LOG.info(
            "MQTT connected; subscribed to %s, %s and service topics for controllerId=%s",
            MQTT_TOPIC, STATUS_TOPIC, SERVICE_CONTROLLER_ID,
        )
    else:
        LOG.warning("MQTT connected; service monitor disabled until CRM_SERVICE_*_URL values are configured")


def on_message(_client: mqtt.Client, _userdata: Any, message: mqtt.MQTTMessage) -> None:
    try:
        payload = json.loads(message.payload.decode("utf-8"))
        if message.topic.startswith("service/") and message.qos != 1:
            raise ValueError("service MQTT messages must use QoS 1")
        if message.topic == f"coolmonitor/devices/{CRM_DEVICE_ID}/telemetry":
            message_id, body = telemetry_body(payload, message.topic)
            message_type = "telemetry"
        elif message.topic == f"coolmonitor/devices/{CRM_DEVICE_ID}/status":
            message_id, body = status_body(payload, message.topic)
            message_type = "status"
        elif SERVICE_MQTT_ENABLED and message.topic == f"service/{SERVICE_CONTROLLER_ID}/heartbeat":
            message_id, body = service_heartbeat_body(payload, message.topic)
            message_type = "service_heartbeat"
        elif SERVICE_MQTT_ENABLED and message.topic == f"service/{SERVICE_CONTROLLER_ID}/log":
            message_id, body = service_log_body(payload, message.topic)
            message_type = "service_log"
        elif SERVICE_MQTT_ENABLED and message.topic == f"service/{SERVICE_CONTROLLER_ID}/status":
            if not message.retain:
                raise ValueError("service status must be retained")
            message_id, body = service_status_body(payload, message.topic)
            message_type = "service_status"
        elif SERVICE_MQTT_ENABLED and message.topic == f"service/{SERVICE_CONTROLLER_ID}/command/result":
            message_id, body = service_command_result_body(payload, message.topic)
            message_type = "service_command_result"
        else:
            raise ValueError("unexpected MQTT topic")
        enqueue(message_type, message_id, body)
        if message_type == "status":
            LOG.info("MQTT queued controllerId=%s statusId=%s", CRM_DEVICE_ID, message_id)
        elif message_type in SERVICE_MESSAGE_TYPES:
            LOG.info("MQTT queued serviceControllerId=%s messageType=%s messageId=%s",
                     SERVICE_CONTROLLER_ID, message_type, message_id)
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
    for worker_number in range(1, DELIVERY_WORKERS + 1):
        threading.Thread(
            target=delivery_worker, args=(worker_number,), name=f"crm-delivery-{worker_number}", daemon=True
        ).start()
    threading.Thread(target=stats_reporter, name="crm-delivery-stats", daemon=True).start()
    if SERVICE_MQTT_ENABLED:
        threading.Thread(target=service_command_poller, args=(client,), name="crm-service-command-poller", daemon=True).start()
    LOG.info("CRM delivery workers started count=%d", DELIVERY_WORKERS)
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
