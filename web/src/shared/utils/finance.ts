/**
 * Fixed monthly costs that do not vary per repair: box rent, staff salaries and
 * freezer rental income. These are edited as a single "current" configuration,
 * so past months are reconstructed from snapshots frozen at the moment the
 * configuration last changed (see {@link backfillFixedCostHistory}).
 */
export interface FixedCosts {
  boxCost: number;
  salCost: number;
  rentalIncome: number;
}

export interface FinanceFixedCostShape {
  boxes?: Array<{ cost?: number | string }>;
  salaries?: Array<{ salary?: number | string }>;
  fixedCostHistory?: Record<string, Partial<FixedCosts> | undefined>;
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export function sumBoxCost(boxes?: FinanceFixedCostShape["boxes"]): number {
  return (boxes ?? []).reduce((s, b) => s + toNum(b?.cost), 0);
}

export function sumSalaries(salaries?: FinanceFixedCostShape["salaries"]): number {
  return (salaries ?? []).reduce((s, x) => s + toNum(x?.salary), 0);
}

/** `mk` (`YYYY-MM`) shifted by `delta` whole months. */
export function shiftMonth(mk: string, delta: number): string {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fixed costs that applied during month `mk`: the frozen snapshot when one
 * exists, otherwise the live current configuration. The current month and
 * future months intentionally have no snapshot and track the live values.
 */
export function resolveFixedCosts(
  finance: FinanceFixedCostShape,
  liveRentalIncome: number,
  mk: string,
): FixedCosts {
  const snap = finance.fixedCostHistory?.[mk];
  const live: FixedCosts = {
    boxCost: sumBoxCost(finance.boxes),
    salCost: sumSalaries(finance.salaries),
    rentalIncome: liveRentalIncome,
  };
  if (!snap) return live;
  return {
    boxCost: snap.boxCost ?? live.boxCost,
    salCost: snap.salCost ?? live.salCost,
    rentalIncome: snap.rentalIncome ?? live.rentalIncome,
  };
}

/**
 * Freeze `snapshot` (the values that applied up to now) onto every month in
 * `[nowMk - lookbackMonths, nowMk - 1]` that has no snapshot yet. `nowMk` itself
 * is left untouched so it keeps tracking the freshly-saved configuration.
 * Existing snapshots are never overwritten. Returns a new object; the input is
 * not mutated.
 */
export function backfillFixedCostHistory(
  existing: Record<string, Partial<FixedCosts> | undefined> | undefined,
  snapshot: FixedCosts,
  nowMk: string,
  lookbackMonths = 24,
): Record<string, Partial<FixedCosts>> {
  const history: Record<string, Partial<FixedCosts>> = {};
  for (const [mk, value] of Object.entries(existing ?? {})) {
    if (value) history[mk] = value;
  }
  for (let i = 1; i <= lookbackMonths; i++) {
    const mk = shiftMonth(nowMk, -i);
    if (history[mk] == null) history[mk] = snapshot;
  }
  return history;
}
