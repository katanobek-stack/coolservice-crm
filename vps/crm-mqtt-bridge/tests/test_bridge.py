import importlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_DIR))


def load_bridge(data_dir: Path):
    os.environ.update({
        "BRIDGE_DATA_DIR": str(data_dir), "MQTT_HOST": "127.0.0.1", "MQTT_PORT": "1883",
        "MQTT_USERNAME": "test", "MQTT_PASSWORD": "test", "MQTT_TOPIC": "coolmonitor/devices/+/telemetry",
        "CRM_URL": "https://telemetry.example.test", "CRM_STATUS_URL": "https://status.example.test",
        "CRM_DEVICE_ID": "device-001", "CRM_DEVICE_KEY": "test-key",
    })
    sys.modules.pop("bridge", None)
    return importlib.import_module("bridge")


def status_payload():
    return {
        "controllerId": "device-001", "statusId": "boot-a:status-1",
        "reportedAt": "2026-09-17T01:23:45.000Z", "networkRegistered": True,
        "registrationState": "home", "rssi": 21, "gprsConnected": True,
        "mqttConnected": True, "queueDepth": 0, "lastFailureCode": "none", "uptimeSeconds": 3600,
    }


class BridgeTests(unittest.TestCase):
    def test_existing_telemetry_contract_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            packet_id, body = bridge.telemetry_body({
                "controllerId": "device-001", "packetId": "boot-a:1", "sensorId": "temperature-1",
                "measuredAt": "2026-09-17T01:23:45.000Z", "value": -18.5,
            }, "coolmonitor/devices/device-001/telemetry")
            self.assertEqual(packet_id, "boot-a:1")
            self.assertEqual(json.loads(body)["measurements"][0]["temperatureC"], -18.5)

    def test_telemetry_passes_optional_time_quality_without_changing_legacy_messages(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            payload = {
                "controllerId": "device-001", "packetId": "boot-a:estimated", "sensorId": "temperature-1",
                "measuredAt": "2026-09-17T01:23:45.000Z", "value": -18.5, "timeQuality": "estimated",
            }
            _, body = bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")
            self.assertEqual(json.loads(body)["measurements"][0]["timeQuality"], "estimated")
            payload["timeQuality"] = "unknown"
            with self.assertRaises(ValueError):
                bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")

    def test_unplaced_telemetry_omits_measured_at_and_preserves_sensor_id(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            payload = {
                "controllerId": "device-001", "packetId": "previous-boot:1", "sensorId": "temperature-1",
                "value": -18.5, "timeQuality": "unplaced",
            }
            _, body = bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")
            measurement = json.loads(body)["measurements"][0]
            self.assertEqual(measurement, {
                "temperatureC": -18.5, "sensorId": "temperature-1", "timeQuality": "unplaced",
            })
            payload["measuredAt"] = "2026-09-17T01:23:45.000Z"
            with self.assertRaises(ValueError):
                bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")

    def test_status_is_validated_and_status_id_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            status_id, body = bridge.status_body(status_payload(), "coolmonitor/devices/device-001/status")
            self.assertEqual(status_id, "boot-a:status-1")
            self.assertEqual(json.loads(body)["statusId"], status_id)
            invalid = status_payload()
            invalid["controllerId"] = "device-002"
            with self.assertRaises(ValueError):
                bridge.status_body(invalid, "coolmonitor/devices/device-001/status")

    def test_legacy_queue_migration_keeps_pending_telemetry(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            database = data_dir / "queue.sqlite3"
            connection = sqlite3.connect(database)
            connection.executescript("""
                CREATE TABLE pending (packet_id TEXT PRIMARY KEY, body TEXT NOT NULL, received_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT);
                CREATE TABLE rejected (packet_id TEXT PRIMARY KEY, body TEXT NOT NULL, rejected_at INTEGER NOT NULL, reason TEXT NOT NULL);
                INSERT INTO pending VALUES ('legacy-packet', '{"deviceId":"device-001"}', 100, 2, 200, 'network');
            """)
            connection.commit()
            connection.close()
            bridge = load_bridge(data_dir)
            row = bridge.DB.execute(
                "SELECT message_type, message_id, attempts, delivery_state, claimed_at FROM pending"
            ).fetchone()
            self.assertEqual(row, ("telemetry", "legacy-packet", 2, "pending", None))
            bridge.enqueue("status", "legacy-packet", "{}")
            self.assertEqual(bridge.DB.execute("SELECT count(*) FROM pending").fetchone()[0], 2)

    def test_restart_returns_inflight_delivery_to_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            bridge = load_bridge(data_dir)
            bridge.enqueue("telemetry", "boot-a:inflight", "{}")
            claimed = bridge.claim_next_delivery()
            self.assertEqual(claimed[1], "boot-a:inflight")
            self.assertEqual(
                bridge.DB.execute("SELECT delivery_state FROM pending WHERE message_id = ?", ("boot-a:inflight",)).fetchone(),
                ("inflight",),
            )
            bridge.DB.close()
            bridge = load_bridge(data_dir)
            self.assertEqual(
                bridge.DB.execute("SELECT delivery_state, claimed_at FROM pending WHERE message_id = ?", ("boot-a:inflight",)).fetchone(),
                ("pending", None),
            )

    def test_telemetry_success_response_reports_stored_count(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            self.assertEqual(
                bridge.telemetry_delivery_result(
                    b'{"packetId":"boot-a:1","outcome":"stored","measurementsReceived":2,"measurementsCreated":2}'
                ),
                ("stored", 2),
            )

    def test_telemetry_success_response_reports_duplicate_without_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            self.assertEqual(
                bridge.telemetry_delivery_result(
                    b'{"packetId":"boot-a:1","outcome":"duplicate","measurementsReceived":1,"measurementsCreated":0}'
                ),
                ("duplicate", 0),
            )

    def test_telemetry_success_response_handles_invalid_or_non_json_body(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            self.assertEqual(bridge.telemetry_delivery_result(b"accepted"), ("unknown", None))
            self.assertEqual(
                bridge.telemetry_delivery_result(b'{"outcome":"duplicate","measurementsCreated":1}'),
                ("unknown", None),
            )


if __name__ == "__main__":
    unittest.main()
