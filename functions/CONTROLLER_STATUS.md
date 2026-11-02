# Controller connection status extensions

`POST https://europe-west1-coolservice-crm.cloudfunctions.net/ingestControllerStatus`
uses the existing per-device Bearer credential and controller status payload.
Controllers do not receive Firestore credentials. Keep keys out of tracked files/logs.

Optional fields (legacy MQTT messages can omit both):

- `transport`: `mqtt` or `https`.
- `simBalance`: `{status, checkedAt, amountMinor?, currency?}`.
  `checkedAt` must be strict UTC ISO, no older than7days and no more than10min
  in the future, using the same validation as reportedAt.
  `status` is `ok`, `error`, `unsupported`, or `unavailable`.
  Only `ok` supplies `amountMinor` (integer kopeks, absolute value≤100000000)
  and `currency:"RUB"`; zero and negative balances are valid.

The transaction writes `monitoringControllerStatus/{controllerId}` and deduped
`statusEvents/{statusId}`. An older balance attempt cannot replace a newer one;
a failed attempt preserves the last successful amount and `balanceAt` while
updating the attempt state/time. Omitted balance preserves the previous value.

Delivery acknowledgment is HTTP202 accepted=true or HTTP200 duplicate=true,
with the exact submitted statusId. A transport send or serial log alone is not
delivery proof. Connection status never substitutes for sensor measurements.

Bench 2026-11-02: new controller coolmonitor-ml307r-001 delivered directly through
ML307R TCP with ESP32 verified TLS and autonomous UDP NTP. Personal Beeline SIM
USSD queries both returned ERROR; balance is truthfully unsupported. The legacy
device-001 MQTT/VPS path is unchanged. Only ingestControllerStatus was redeployed
on Node22; frontend publication is a separate step.
