#!/usr/bin/env python3
"""Durable MQTT-to-CRM bridge for telemetry and controller diagnostics.

MQTT callbacks only validate and enqueue. The dispatcher thread performs HTTPS
requests later, so a slow Firebase endpoint can never block the MQTT network
loop. Device keys are loaded from a root-readable file on the VPS and are never
stored in SQLite or written to logs.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import paho.mqtt.client as mqtt

DEVICE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
UTC_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$")
TELEMETRY_TOPIC_RE = re.compile(r"^coolmonitor/devices/([a-z0-9][a-z0-9_-]{2,63})/telemetry$")
STATUS_TOPIC_RE = re.compile(r"^coolmonitor/devices/([a-z0-9][a-z0-9_-]{2,63})/status$")
REGISTRATION_STATES = {"home", "roaming", "searching", "denied", "unknown"}
FAILURE_CODES = {
    "none", "modem_not_ready", "network_not_registered", "ntp_sync_failed",
    "gprs_connect_failed", "tcp_connect_failed", "mqtt_connect_failed",
    "publish_send_failed", "puback_timeout", "modem_restarted", "esp_restarted",
}

Kind = Literal["telemetry", "status"]
LOG = logging.getLogger("crm_mqtt_bridge")


class MessageValidationError(ValueError):
    """Payload is not part of a permitted MQTT-to-CRM contract."""


@dataclass(frozen=True)
class Envelope:
    kind: Kind
    controller_id: str
    message_id: str
    payload_json: str


@dataclass(frozen=True)
class Config:
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str | None
    mqtt_password: str | None
    mqtt_client_id: str
    mqtt_tls: bool
    mqtt_ca_file: str | None
    telemetry_url: str
    status_url: str
    device_keys_file: Path
    queue_db: Path

    @classmethod
    def from_env(cls) -> "Config":
        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise RuntimeError(f"{name} is required")
            return value

        mqtt_password_file = os.environ.get("CRM_MQTT_PASSWORD_FILE", "").strip()
        mqtt_password = Path(mqtt_password_file).read_text(encoding="utf-8").strip() if mqtt_password_file else None
        return cls(
            mqtt_host=required("CRM_MQTT_HOST"),
            mqtt_port=int(os.environ.get("CRM_MQTT_PORT", "8883")),
            mqtt_username=os.environ.get("CRM_MQTT_USERNAME") or None,
            mqtt_password=mqtt_password,
            mqtt_client_id=os.environ.get("CRM_MQTT_CLIENT_ID", "crm-mqtt-bridge"),
            mqtt_tls=os.environ.get("CRM_MQTT_TLS", "true").lower() == "true",
            mqtt_ca_file=os.environ.get("CRM_MQTT_CA_FILE") or None,
            telemetry_url=required("CRM_TELEMETRY_URL"),
            status_url=required("CRM_STATUS_URL"),
            device_keys_file=Path(required("CRM_DEVICE_KEYS_FILE")),
            queue_db=Path(os.environ.get("CRM_QUEUE_DB", "/var/lib/crm-mqtt-bridge/queue.sqlite3")),
        )


def _require_exact_keys(value: dict[str, Any], keys: set[str]) -> None:
    if set(value) != keys:
        raise MessageValidationError("unexpected or missing JSON fields")


def _parse_json(raw_payload: bytes) -> tuple[dict[str, Any], str]:
    try:
        raw_text = raw_payload.decode("utf-8")
        parsed = json.loads(raw_text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MessageValidationError("payload is not valid UTF-8 JSON") from error
    if not isinstance(parsed, dict):
        raise MessageValidationError("payload must be a JSON object")
    return parsed, raw_text


def _parse_telemetry(controller_id: str, payload: dict[str, Any], raw_text: str) -> Envelope:
    _require_exact_keys(payload, {"deviceId", "packetId", "measurements"})
    if payload.get("deviceId") != controller_id or not DEVICE_ID_RE.fullmatch(controller_id):
        raise MessageValidationError("deviceId does not match telemetry topic")
    packet_id = payload.get("packetId")
    measurements = payload.get("measurements")
    if not isinstance(packet_id, str) or not EVENT_ID_RE.fullmatch(packet_id):
        raise MessageValidationError("packetId is invalid")
    if not isinstance(measurements, list) or not 1 <= len(measurements) <= 12:
        raise MessageValidationError("measurements must contain 1-12 entries")
    return Envelope("telemetry", controller_id, packet_id, raw_text)


def _parse_status(controller_id: str, payload: dict[str, Any], raw_text: str) -> Envelope:
    _require_exact_keys(payload, {
        "controllerId", "statusId", "reportedAt", "networkRegistered", "registrationState", "rssi",
        "gprsConnected", "mqttConnected", "queueDepth", "lastFailureCode", "uptimeSeconds",
    })
    if payload.get("controllerId") != controller_id or not DEVICE_ID_RE.fullmatch(controller_id):
        raise MessageValidationError("controllerId does not match status topic")
    status_id = payload.get("statusId")
    if not isinstance(status_id, str) or not EVENT_ID_RE.fullmatch(status_id):
        raise MessageValidationError("statusId is invalid")
    reported_at = payload.get("reportedAt")
    if not isinstance(reported_at, str) or not UTC_ISO_RE.fullmatch(reported_at):
        raise MessageValidationError("reportedAt is invalid")
    try:
        datetime.fromisoformat(reported_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise MessageValidationError("reportedAt is invalid") from error
    if not isinstance(payload.get("networkRegistered"), bool):
        raise MessageValidationError("networkRegistered is invalid")
    if payload.get("registrationState") not in REGISTRATION_STATES:
        raise MessageValidationError("registrationState is invalid")
    rssi = payload.get("rssi")
    if rssi is not None and (type(rssi) is not int or not 0 <= rssi <= 31):
        raise MessageValidationError("rssi is invalid")
    if not isinstance(payload.get("gprsConnected"), bool) or not isinstance(payload.get("mqttConnected"), bool):
        raise MessageValidationError("connection state is invalid")
    if type(payload.get("queueDepth")) is not int or payload["queueDepth"] < 0:
        raise MessageValidationError("queueDepth is invalid")
    if payload.get("lastFailureCode") not in FAILURE_CODES:
        raise MessageValidationError("lastFailureCode is invalid")
    if type(payload.get("uptimeSeconds")) is not int or payload["uptimeSeconds"] < 0:
        raise MessageValidationError("uptimeSeconds is invalid")
    return Envelope("status", controller_id, status_id, raw_text)


def parse_mqtt_message(topic: str, raw_payload: bytes) -> Envelope:
    """Validate one supported topic, retaining the JSON text unchanged for POST."""
    payload, raw_text = _parse_json(raw_payload)
    telemetry_match = TELEMETRY_TOPIC_RE.fullmatch(topic)
    if telemetry_match:
        return _parse_telemetry(telemetry_match.group(1), payload, raw_text)
    status_match = STATUS_TOPIC_RE.fullmatch(topic)
    if status_match:
        return _parse_status(status_match.group(1), payload, raw_text)
    raise MessageValidationError("unsupported MQTT topic")


class DurableQueue:
    """SQLite queue. Keys deliberately never enter this database."""

    def __init__(self, database: Path) -> None:
        self.database = database
        database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS deliveries (
                  delivery_id TEXT PRIMARY KEY,
                  kind TEXT NOT NULL CHECK(kind IN ('telemetry', 'status')),
                  controller_id TEXT NOT NULL,
                  message_id TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'inflight', 'dead')),
                  attempts INTEGER NOT NULL DEFAULT 0,
                  next_attempt_at REAL NOT NULL,
                  last_http_status INTEGER,
                  created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS deliveries_ready ON deliveries(state, next_attempt_at);
            """)
            connection.execute("UPDATE deliveries SET state = 'pending' WHERE state = 'inflight'")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        return connection

    def enqueue(self, item: Envelope) -> bool:
        delivery_id = f"{item.kind}:{item.controller_id}:{item.message_id}"
        now = time.time()
        with self._connect() as connection:
            cursor = connection.execute(
                """INSERT OR IGNORE INTO deliveries
                   (delivery_id, kind, controller_id, message_id, payload_json, next_attempt_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (delivery_id, item.kind, item.controller_id, item.message_id, item.payload_json, now, now),
            )
            return cursor.rowcount == 1

    def claim_next(self) -> sqlite3.Row | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM deliveries WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY created_at LIMIT 1",
                (time.time(),),
            ).fetchone()
            if row is not None:
                connection.execute("UPDATE deliveries SET state = 'inflight' WHERE delivery_id = ?", (row["delivery_id"],))
            connection.execute("COMMIT")
            return row

    def complete(self, delivery_id: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM deliveries WHERE delivery_id = ?", (delivery_id,))

    def retry(self, delivery_id: str, attempts: int, http_status: int | None) -> None:
        delay_seconds = min(600, 2 ** min(attempts, 9))
        with self._connect() as connection:
            connection.execute(
                "UPDATE deliveries SET state = 'pending', attempts = ?, next_attempt_at = ?, last_http_status = ? WHERE delivery_id = ?",
                (attempts + 1, time.time() + delay_seconds, http_status, delivery_id),
            )

    def mark_dead(self, delivery_id: str, http_status: int | None) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE deliveries SET state = 'dead', last_http_status = ? WHERE delivery_id = ?",
                (http_status, delivery_id),
            )


def load_device_keys(path: Path) -> dict[str, str]:
    """Read a root-only JSON map: {"device-001": "device key"}."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("unable to read CRM_DEVICE_KEYS_FILE") from error
    if not isinstance(value, dict) or not all(DEVICE_ID_RE.fullmatch(key) and isinstance(key_value, str) and key_value for key, key_value in value.items()):
        raise RuntimeError("CRM_DEVICE_KEYS_FILE has an invalid shape")
    return value


def post_json(url: str, payload_json: str, device_key: str) -> int:
    request = urllib.request.Request(
        url,
        data=payload_json.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {device_key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20, context=ssl.create_default_context()) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def log_delivery(level: str, outcome: str, item: sqlite3.Row, http_code: int | None) -> None:
    """Keep logs useful for support without exposing payloads or credentials."""
    log = getattr(LOG, level)
    if item["kind"] == "status":
        log("delivery %s controllerId=%s statusId=%s httpCode=%s", outcome, item["controller_id"], item["message_id"], http_code if http_code is not None else "none")
    else:
        log("delivery %s controllerId=%s httpCode=%s", outcome, item["controller_id"], http_code if http_code is not None else "none")


class Dispatcher(threading.Thread):
    def __init__(self, queue: DurableQueue, config: Config, keys: dict[str, str], stop_event: threading.Event) -> None:
        super().__init__(name="crm-http-dispatcher", daemon=True)
        self.queue, self.config, self.keys, self.stop_event = queue, config, keys, stop_event

    def run(self) -> None:
        while not self.stop_event.is_set():
            item = self.queue.claim_next()
            if item is None:
                self.stop_event.wait(0.5)
                continue
            key = self.keys.get(item["controller_id"])
            if not key:
                self.queue.mark_dead(item["delivery_id"], None)
                log_delivery("error", "rejected", item, None)
                continue
            url = self.config.telemetry_url if item["kind"] == "telemetry" else self.config.status_url
            try:
                status_code = post_json(url, item["payload_json"], key)
            except (OSError, urllib.error.URLError):
                self.queue.retry(item["delivery_id"], item["attempts"], None)
                log_delivery("warning", "retry", item, None)
                continue
            if status_code in (200, 202):
                self.queue.complete(item["delivery_id"])
                log_delivery("info", "accepted", item, status_code)
            elif status_code in (400, 401):
                self.queue.mark_dead(item["delivery_id"], status_code)
                log_delivery("error", "rejected", item, status_code)
            else:
                self.queue.retry(item["delivery_id"], item["attempts"], status_code)
                log_delivery("warning", "retry", item, status_code)


def run() -> None:
    config = Config.from_env()
    keys = load_device_keys(config.device_keys_file)
    queue = DurableQueue(config.queue_db)
    stop_event = threading.Event()
    dispatcher = Dispatcher(queue, config, keys, stop_event)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=config.mqtt_client_id, protocol=mqtt.MQTTv311)
    if config.mqtt_username:
        client.username_pw_set(config.mqtt_username, config.mqtt_password)
    if config.mqtt_tls:
        client.tls_set(ca_certs=config.mqtt_ca_file)
        client.tls_insecure_set(False)

    def on_connect(client: mqtt.Client, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any) -> None:
        if getattr(reason_code, "is_failure", False):
            LOG.error("mqtt connection refused code=%s", reason_code)
            return
        client.subscribe("coolmonitor/devices/+/telemetry", qos=1)
        client.subscribe("coolmonitor/devices/+/status", qos=1)
        LOG.info("mqtt connected")

    def on_message(_client: mqtt.Client, _userdata: Any, message: mqtt.MQTTMessage) -> None:
        try:
            item = parse_mqtt_message(message.topic, message.payload)
            enqueued = queue.enqueue(item)
            if item.kind == "status":
                LOG.info("mqtt queued controllerId=%s statusId=%s duplicate=%s", item.controller_id, item.message_id, not enqueued)
            else:
                LOG.info("mqtt queued controllerId=%s duplicate=%s", item.controller_id, not enqueued)
        except MessageValidationError:
            # Topic and payload are untrusted. Do not log their full content.
            LOG.warning("mqtt payload rejected")

    client.on_connect = on_connect
    client.on_message = on_message
    dispatcher.start()
    try:
        client.connect(config.mqtt_host, config.mqtt_port, keepalive=60)
        client.loop_forever(retry_first_connection=True)
    finally:
        stop_event.set()
        dispatcher.join(timeout=5)
        client.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=os.environ.get("CRM_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    run()
