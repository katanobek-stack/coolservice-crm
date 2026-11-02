export type BalanceStatus = "ok" | "error" | "unsupported" | "unavailable";
export interface IncomingSimBalance {
  status: BalanceStatus;
  checkedAt: Date;
  amountMinor?: number;
  currency?: "RUB";
}
export interface StatusExtensions {
  transport?: "mqtt" | "https";
  simBalance?: IncomingSimBalance;
}

export function parseStatusExtensions(
  body: Record<string, unknown>, parseUtc: (value: unknown) => Date,
): StatusExtensions {
  const result: StatusExtensions = {};
  if (body.transport !== undefined) {
    if (body.transport !== "mqtt" && body.transport !== "https") throw new Error("transport must be mqtt or https");
    result.transport = body.transport;
  }
  if (body.simBalance !== undefined) {
    const value = body.simBalance;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("simBalance must be an object");
    const balance = value as Record<string, unknown>;
    if (Object.keys(balance).some(key => !["status", "checkedAt", "amountMinor", "currency"].includes(key))) throw new Error("simBalance contains unknown fields");
    if (!["ok", "error", "unsupported", "unavailable"].includes(balance.status as string)) throw new Error("invalid simBalance status");
    const parsed: IncomingSimBalance = { status: balance.status as BalanceStatus, checkedAt: parseUtc(balance.checkedAt) };
    if (balance.status === "ok") {
      if (!Number.isSafeInteger(balance.amountMinor) || Math.abs(balance.amountMinor as number) > 100_000_000 || balance.currency !== "RUB") throw new Error("simBalance requires integer kopeks and RUB currency");
      parsed.amountMinor = balance.amountMinor as number;
      parsed.currency = "RUB";
    } else if (balance.amountMinor !== undefined || balance.currency !== undefined) throw new Error("failed balance check cannot supply an amount");
    result.simBalance = parsed;
  }
  return result;
}

function milliseconds(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

export function storedSimBalance(
  previous: unknown, incoming: IncomingSimBalance | undefined, timestamp: (date: Date) => unknown,
): Record<string, unknown> | undefined {
  const old = previous && typeof previous === "object" && !Array.isArray(previous) ? previous as Record<string, unknown> : undefined;
  if (!incoming || (old && milliseconds(old.checkedAt) >= incoming.checkedAt.getTime())) return old;
  const result: Record<string, unknown> = { status: incoming.status, checkedAt: timestamp(incoming.checkedAt) };
  if (incoming.status === "ok") {
    return { ...result, amountMinor: incoming.amountMinor, currency: incoming.currency, balanceAt: timestamp(incoming.checkedAt) };
  }
  if (old && Number.isSafeInteger(old.amountMinor) && old.currency === "RUB" && old.balanceAt) {
    result.amountMinor = old.amountMinor;
    result.currency = "RUB";
    result.balanceAt = old.balanceAt;
  }
  return result;
}
