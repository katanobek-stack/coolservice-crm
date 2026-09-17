import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from crm_mqtt_bridge import DurableQueue, MessageValidationError, parse_mqtt_message


def telemetry_payload() -> bytes:
    return json.dumps({
        "deviceId": "device-001", "packetId": "boot-a:42",
        "measurements": [{"measuredAt": "2026-09-17T01:23:45.000Z", "temperatureC": -18.5}],
    }).encode()


def status_payload() -> bytes:
    return json.dumps({
        "controllerId": "device-001", "statusId": "boot-a:status-42",
        "reportedAt": "2026-09-17T01:23:45.000Z", "networkRegistered": True,
        "registrationState": "home", "rssi": 21, "gprsConnected": True,
        "mqttConnected": True, "queueDepth": 0, "lastFailureCode": "none", "uptimeSeconds": 3600,
    }).encode()


class TopicParsingTests(unittest.TestCase):
    def test_telemetry_topic_keeps_existing_packet_contract(self) -> None:
        message = parse_mqtt_message("coolmonitor/devices/device-001/telemetry", telemetry_payload())
        self.assertEqual((message.kind, message.controller_id, message.message_id), ("telemetry", "device-001", "boot-a:42"))

    def test_status_topic_preserves_status_id_and_raw_json(self) -> None:
        raw = status_payload()
        message = parse_mqtt_message("coolmonitor/devices/device-001/status", raw)
        self.assertEqual((message.kind, message.controller_id, message.message_id), ("status", "device-001", "boot-a:status-42"))
        self.assertEqual(message.payload_json, raw.decode())

    def test_status_controller_id_must_match_topic(self) -> None:
        invalid = json.loads(status_payload())
        invalid["controllerId"] = "device-002"
        with self.assertRaises(MessageValidationError):
            parse_mqtt_message("coolmonitor/devices/device-001/status", json.dumps(invalid).encode())

    def test_unsupported_topic_is_rejected(self) -> None:
        with self.assertRaises(MessageValidationError):
            parse_mqtt_message("coolmonitor/devices/device-001/other", status_payload())


class DurableQueueTests(unittest.TestCase):
    def test_queue_separates_topics_and_deduplicates_each_kind(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            queue = DurableQueue(Path(directory) / "queue.sqlite3")
            telemetry = parse_mqtt_message("coolmonitor/devices/device-001/telemetry", telemetry_payload())
            status = parse_mqtt_message("coolmonitor/devices/device-001/status", status_payload())
            self.assertTrue(queue.enqueue(telemetry))
            self.assertTrue(queue.enqueue(status))
            self.assertFalse(queue.enqueue(status))
            first = queue.claim_next()
            self.assertIsNotNone(first)
            queue.complete(first["delivery_id"])
            second = queue.claim_next()
            self.assertIsNotNone(second)
            self.assertNotEqual(first["kind"], second["kind"])

    def test_retry_is_durable_and_dead_messages_are_not_claimed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "queue.sqlite3"
            queue = DurableQueue(database)
            item = parse_mqtt_message("coolmonitor/devices/device-001/status", status_payload())
            queue.enqueue(item)
            claimed = queue.claim_next()
            self.assertIsNotNone(claimed)
            queue.retry(claimed["delivery_id"], claimed["attempts"], 503)
            with sqlite3.connect(database) as connection:
                self.assertEqual(connection.execute("SELECT state, attempts, last_http_status FROM deliveries").fetchone(), ("pending", 1, 503))
            with sqlite3.connect(database) as connection:
                connection.execute("UPDATE deliveries SET next_attempt_at = 0")
            claimed_again = queue.claim_next()
            self.assertIsNotNone(claimed_again)
            queue.mark_dead(claimed_again["delivery_id"], 401)
            self.assertIsNone(queue.claim_next())


if __name__ == "__main__":
    unittest.main()
