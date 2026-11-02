# ML307R direct monitoring

Approved conversation scope: register a second test controller, separate from
device-001, using ESP32 TLS over ML307R TCP to the existing Firebase HTTPS
ingestion functions. Show it in the same Monitoring registry and diagnostics.
Add optional transport and SIM balance information without changing the VPS,
broker, old controller, Firestore device permissions or temperature history.

Controller: `coolmonitor-ml307r-001`, name `CoolMonitoring ML307R — стенд`,
enabled, isTest, no client/object assignment. Provision registry and scrypt
credential hash atomically with create-only preconditions; never overwrite an
existing device/credential. Raw key stays in ignored local device_config.h.

First delivery is actual controller status, not invented sensor data. Validate
UTC, certificate chain and hostname; use unique statusId, HTTP 202/200 plus a
read-back of Firebase current state to prove delivery. No direct Firestore
access from firmware. Keep source and deploy changes scoped to this feature.

Optional status extensions: transport `mqtt`/`https` (absence means legacy
MQTT); simBalance with status `ok`/`error`/`unsupported`/`unavailable`, checkedAt
UTC, and amountMinor integer plus RUB currency on success. Failed checks retain
the last successful balance and its timestamp; zero is a real amount only.
Old payloads remain valid. UI must not describe unused MQTT as a broken HTTPS
connection. No automatic key disclosure in output or logs.

Balance acquisition must be bench-tested on this ML307R/Beeline combination.
If unsupported, display that accurately; never fabricate an amount. Temperature
sensor wiring and samples follow after this controller is visible and online.

Implementation in the existing clean checkout on codex/ml307r-direct-monitoring;
user requested continuous execution. No commit or push is authorized.
