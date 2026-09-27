import importlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BRIDGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_DIR))


def load_bridge(data_dir: Path, service_key: str | None = "service-test-key"):
    config = {
        "BRIDGE_DATA_DIR": str(data_dir), "MQTT_HOST": "127.0.0.1", "MQTT_PORT": "1883",
        "MQTT_USERNAME": "test", "MQTT_PASSWORD": "test", "MQTT_TOPIC": "coolmonitor/devices/+/telemetry",
        "CRM_URL": "https://telemetry.example.test", "CRM_STATUS_URL": "https://status.example.test",
        "CRM_DEVICE_ID": "device-001", "CRM_DEVICE_KEY": "telemetry-test-key",
        "CRM_SERVICE_CONTROLLER_ID": "service-001",
        "CRM_SERVICE_HEARTBEAT_URL": "https://service.example.test/heartbeat",
        "CRM_SERVICE_LOG_URL": "https://service.example.test/log",
        "CRM_SERVICE_STATUS_URL": "https://service.example.test/status",
        "CRM_SERVICE_COMMAND_RESULT_URL": "https://service.example.test/command-result",
        "CRM_SERVICE_COMMAND_CLAIM_URL": "https://service.example.test/command-claim",
        "CRM_SERVICE_COMMAND_DISPATCH_URL": "https://service.example.test/command-dispatch",
    }
    if service_key is None:
        os.environ.pop("CRM_SERVICE_CONTROLLER_KEY", None)
    else:
        config["CRM_SERVICE_CONTROLLER_KEY"] = service_key
    os.environ.update(config)
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
    class Response:
        def __init__(self, status=202, body=b"{}"):
            self.status = status
            self.body = body

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, _type, _value, _traceback):
            return False

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
                "deliveryQuality": "delayed",
            }
            _, body = bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")
            self.assertEqual(json.loads(body)["measurements"][0]["timeQuality"], "estimated")
            self.assertEqual(json.loads(body)["measurements"][0]["deliveryQuality"], "delayed")
            payload["timeQuality"] = "unknown"
            with self.assertRaises(ValueError):
                bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")

            payload["timeQuality"] = "exact"
            payload["deliveryQuality"] = "unknown"
            with self.assertRaises(ValueError):
                bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")

    def test_legacy_telemetry_omits_delivery_quality_for_server_default(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            _, body = bridge.telemetry_body({
                "controllerId": "device-001", "packetId": "boot-a:legacy", "sensorId": "temperature-1",
                "measuredAt": "2026-09-17T01:23:45.000Z", "value": -18.5,
            }, "coolmonitor/devices/device-001/telemetry")
            self.assertNotIn("deliveryQuality", json.loads(body)["measurements"][0])

    def test_unplaced_telemetry_omits_measured_at_and_preserves_sensor_id(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            payload = {
                "controllerId": "device-001", "packetId": "previous-boot:1", "sensorId": "temperature-1",
                "value": -18.5, "timeQuality": "unplaced", "deliveryQuality": "delayed",
            }
            _, body = bridge.telemetry_body(payload, "coolmonitor/devices/device-001/telemetry")
            measurement = json.loads(body)["measurements"][0]
            self.assertEqual(measurement, {
                "temperatureC": -18.5, "sensorId": "temperature-1", "timeQuality": "unplaced",
                "deliveryQuality": "delayed",
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

    def test_service_topics_validate_controller_and_preserve_stable_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            heartbeat_id, heartbeat = bridge.service_heartbeat_body({
                "controllerId": "service-001", "heartbeatId": "boot-a:heartbeat-1",
                "reportedAt": "2026-09-17T01:23:45.000Z", "ip": None, "simSignal": 21,
                "modemState": "ready", "gprsConnected": True, "firmwareVersion": "1.0.0",
                "uptimeSeconds": 60, "freeHeapBytes": 1, "flashBytes": 2, "psramBytes": 0,
                "resetReason": "power_on", "uartConnected": True,
            }, "service/service-001/heartbeat")
            self.assertEqual(heartbeat_id, "boot-a:heartbeat-1")
            self.assertEqual(json.loads(heartbeat)["controllerId"], "service-001")
            log_id, _ = bridge.service_log_body({
                "controllerId": "service-001", "logId": "boot-a:log-1",
                "reportedAt": "2026-09-17T01:23:45.000Z", "level": "INFO", "message": "TARGET << ready",
            }, "service/service-001/log")
            self.assertEqual(log_id, "boot-a:log-1")
            status_id, _ = bridge.service_status_body({
                "controllerId": "service-001", "statusId": "boot-a:offline",
                "reportedAt": "2026-09-17T01:23:45.000Z", "state": "offline",
            }, "service/service-001/status")
            self.assertEqual(status_id, "boot-a:offline")
            result_id, _ = bridge.service_command_result_body({
                "controllerId": "service-001", "commandId": "command-1",
                "reportedAt": "2026-09-17T01:23:45.000Z", "result": "ok", "message": "pong",
            }, "service/service-001/command/result")
            self.assertEqual(result_id, "command-1")
            with self.assertRaises(ValueError):
                bridge.service_log_body({
                    "controllerId": "service-002", "logId": "boot-a:log-1",
                    "reportedAt": "2026-09-17T01:23:45.000Z", "level": "INFO", "message": "x",
                }, "service/service-001/log")

    def test_service_topics_cannot_reuse_telemetry_device_id(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            with self.assertRaises(ValueError):
                bridge.service_status_body({
                    "controllerId": "device-001", "statusId": "boot-a:online",
                    "reportedAt": "2026-09-17T01:23:45.000Z", "state": "online",
                }, "service/device-001/status")

    def test_service_requests_use_only_the_service_controller_key(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory))
            captured = []

            def open_request(request, timeout):
                captured.append(request)
                return self.Response()

            with patch.object(bridge.urllib.request, "urlopen", open_request):
                bridge.deliver_claimed("service_log", "log-1", "{}", 0)
                bridge.service_request("https://service.example.test/command-claim", {"controllerId": "service-001"})
                bridge.deliver_claimed("telemetry", "packet-1", "{}", 0)

            self.assertEqual(captured[0].get_header("Authorization"), "Bearer service-test-key")
            self.assertEqual(captured[1].get_header("Authorization"), "Bearer service-test-key")
            self.assertEqual(captured[2].get_header("Authorization"), "Bearer telemetry-test-key")
            with self.assertRaises(ValueError):
                bridge.delivery_credential("unknown")

    def test_missing_service_key_disables_service_http_without_blocking_telemetry(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = load_bridge(Path(directory), service_key=None)
            self.assertFalse(bridge.SERVICE_MQTT_ENABLED)
            bridge.enqueue("service_log", "saved-service-log", "{}")
            bridge.enqueue("telemetry", "saved-telemetry", "{}")
            claimed = bridge.claim_next_delivery()
            self.assertEqual(claimed[0:2], ("telemetry", "saved-telemetry"))
            with self.assertRaisesRegex(RuntimeError, "service HTTPS is disabled"):
                bridge.service_request("https://service.example.test/command-claim", {"controllerId": "service-001"})

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
            bridge.enqueue("service_log", "legacy-log", "{}")
            self.assertEqual(bridge.DB.execute("SELECT count(*) FROM pending").fetchone()[0], 3)

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
