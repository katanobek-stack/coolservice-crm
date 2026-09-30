export const SERVICE_MONITOR_OFFLINE_MINUTES = 5;

export function isServiceControllerOnline(
  enabled: boolean,
  lastHeartbeatAt: Date | null,
  nowMs: number,
  connectionState: "online" | "offline" | null = null,
  lastStatusAt: Date | null = null,
): boolean {
  if (!enabled) return false;
  // A heartbeat is the controller's current, authenticated contact. A retained
  // MQTT LWT can be old after the controller reconnects, so it must not turn a
  // recently received heartbeat into a false offline indication.
  if (lastHeartbeatAt !== null &&
    nowMs - lastHeartbeatAt.getTime() <= SERVICE_MONITOR_OFFLINE_MINUTES * 60_000) {
    return true;
  }
  if (connectionState === "offline") return false;
  const latestContact = [lastHeartbeatAt, lastStatusAt]
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>((latest, value) => !latest || value > latest ? value : latest, null);
  return latestContact !== null &&
    nowMs - latestContact.getTime() <= SERVICE_MONITOR_OFFLINE_MINUTES * 60_000;
}
