#pragma once

// Copy this file to config.h on the computer used to build the firmware.
// config.h is intentionally ignored by Git.
// Never paste its values into an issue, chat, CI log, or repository file.

// Broker values must match the existing crm-mqtt-bridge configuration on VPS.
// The current broker transport is plain MQTT/TCP; do not silently enable a
// different broker or protocol here.
#define MQTT_HOST "replace-with-existing-broker-host"
#define MQTT_PORT 1883
#define MQTT_USERNAME "replace-with-existing-mqtt-username"
#define MQTT_PASSWORD "replace-with-existing-mqtt-password"

// Beeline settings used by the existing service-controller baseline.
#define GPRS_APN "internet.beeline.ru"
#define GPRS_USERNAME ""
#define GPRS_PASSWORD ""
#define NTP_SERVER "pool.ntp.org"

// This is the service controller identity. It is not a credential.
#define SERVICE_CONTROLLER_ID "service-001"
