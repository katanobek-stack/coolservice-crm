export const SERVICE_MONITOR_OFFLINE_MINUTES = 5;

export function isServiceControllerOnline(
  enabled: boolean,
  lastHeartbeatAt: Date | null,
  nowMs: number,
): boolean {
  return enabled &&
    lastHeartbeatAt !== null &&
    nowMs - lastHeartbeatAt.getTime() <= SERVICE_MONITOR_OFFLINE_MINUTES * 60_000;
}
