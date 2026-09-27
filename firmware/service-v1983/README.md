# Service V1983

This directory contains the `service_controller_v10_mqtt` firmware for
service-controller `service-001`.

The current workspace does not contain a source file labelled V9. V10 is based
on the available, working V1983 baseline
`C:\\Users\\Admin\\Downloads\\service_controller_v5_target_uart.ino`, preserving its
SIM800L pins, SH1106 OLED, encoder/back button and TARGET UART. It uses:

- controllerId: service-001;
- service/service-001/heartbeat;
- service/service-001/log;
- service/service-001/status;
- service/service-001/command;
- service/service-001/command/result;
- QoS 1, retained online/offline status, Last Will offline, reconnect backoff,
  commandId deduplication, and only SERVICE PING/STATUS/INFO.

Create a machine-local `config.h` from `config.example.h` before building. It
is ignored by Git and must contain the broker host, username and password;
never commit it. Its broker values must be copied from the existing VPS bridge
environment by an authorized operator, never guessed or substituted with a new
MQTT system.

## Build and flashing

1. Copy `config.example.h` to `config.h` locally and fill the existing broker
   host, username and password. Keep the file outside Git.
2. In Arduino IDE select the confirmed V1983 ESP32 target and install the
   existing dependencies: TinyGSM and Adafruit GFX/SH110X. No MQTT credential
   belongs in the sketch itself.
3. Open `service_controller_v10_mqtt.ino`, compile and upload manually. Do not
   change SIM800L, OLED, or TARGET-UART pin assignments without a hardware
   check.
4. Observe the serial monitor at 115200. Confirm retained `online` status,
   then heartbeat/log/status traffic; only the three whitelisted commands may
   be tested.

The service controller's MQTT client needs only the existing Mosquitto broker
credentials in `config.h`. Its Firestore credential is held by the VPS bridge,
not by this firmware. `service-001` has an independent credential hash in
Firestore; it does not reuse, reveal, or rotate the telemetry credential for
`device-001`.
