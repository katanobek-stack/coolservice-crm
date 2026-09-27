# Service V1983

This directory is reserved for service-controller firmware for service-001.
It must be created by applying the MQTT adapter to the known-working V9 source,
not by deriving behavior from the diagnostic SIM900A sketch.

The V9 source is not present in this repository. Before implementation, provide
its local path or attach the source tree. The resulting firmware will use:

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

## Flashing after V9 is supplied

1. Copy the actual V9 source tree into this directory and apply the reviewed
   MQTT adapter; do not overwrite the known-working source in `Downloads`.
2. Copy `config.example.h` to `config.h` locally and fill the existing broker
   host, username and password. Keep the file outside Git.
3. Select the already confirmed V1983 ESP32 board and the same serial port used
   for the working V9 build. Do not change SIM800L, OLED, or target-UART pin
   assignments without the V9 source and a hardware check.
4. Compile, upload manually, and observe the serial monitor at the V9 baud
   rate. Confirm retained `online` status, then heartbeat/log/status traffic;
   only the three whitelisted commands may be tested.

No flashable V1983 MQTT sketch is committed yet because the requested V9
baseline is not present in the workspace. This avoids replacing working UART,
OLED, SIM800L or command behavior with an inferred implementation.

The service controller's MQTT client needs only the existing Mosquitto broker
credentials in `config.h`. Its Firestore credential is held by the VPS bridge,
not by this firmware. `service-001` has an independent credential hash in
Firestore; it does not reuse, reveal, or rotate the telemetry credential for
`device-001`.
