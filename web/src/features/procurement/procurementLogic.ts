import type { ProcurementOrderLine, ProcurementSettings } from '../../shared/types/procurement';

export function parseDecimal(value: string, scale: number): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const decimals = Math.round(Math.log10(scale));
  if (fraction.length > decimals) return null;
  const result = Number(whole) * scale + Number(fraction.padEnd(decimals, '0'));
  return Number.isSafeInteger(result) && result <= 1e12 ? result : null;
}

export function safeSupplierUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const allowed = ['taobao.com', 'tmall.com', '1688.com', 'alibaba.com'];
    if (!allowed.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return null;
    return url.href;
  } catch { return null; }
}

function rounded(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const value = (numerator * 2n + denominator) / (2n * denominator);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}
function add(values: (number | null)[]): number | null {
  if (values.some(value => value === null)) return null;
  const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return Number.isSafeInteger(sum) ? sum : null;
}
function allocate(total: number, weights: number[]): number[] {
  const weight = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (weight === 0n) return weights.map(() => 0);
  const rows = weights.map((value, index) => ({ index, value: Number(BigInt(total) * BigInt(value) / weight), remainder: BigInt(total) * BigInt(value) % weight }));
  let remaining = total - rows.reduce((sum, row) => sum + row.value, 0);
  const sorted = [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const row of sorted) { if (remaining-- <= 0) break; row.value++; }
  return rows.map(row => row.value);
}

export function calculateProcurement(lines: ProcurementOrderLine[], settings: ProcurementSettings) {
  const rate = parseDecimal(settings.exchange, 10000), freightRate = parseDecimal(settings.freightRate, 100);
  const commissionBps = parseDecimal(settings.commission, 100);
  const rows = lines.map(line => {
    const quantity = parseDecimal(line.quantity, 1000), price = parseDecimal(line.unitPrice, 100);
    const chinaFen = parseDecimal(line.chinaDelivery, 100), received = parseDecimal(line.receivedQuantity, 1000);
    const grams = parseDecimal(line.weightKg, 1000);
    const productsFen = quantity && price !== null ? rounded(BigInt(quantity) * BigInt(price), 1000n) : null;
    const baseFen = productsFen !== null && chinaFen !== null ? add([productsFen, chinaFen]) : null;
    const freightCents = grams !== null && freightRate !== null ? rounded(BigInt(grams) * BigInt(freightRate), 1000n) : null;
    return { productsFen, chinaFen, baseFen, quantity, received, freightCents, receiptMismatch: received !== null && quantity !== null && received !== quantity };
  });
  const productsFen = add(rows.map(row => row.productsFen)), chinaFen = add(rows.map(row => row.chinaFen));
  const baseFen = add(rows.map(row => row.baseFen));
  const commissionFen = baseFen !== null && commissionBps !== null && commissionBps <= 10000 ? rounded(BigInt(baseFen) * BigInt(commissionBps), 10000n) : null;
  const shares = commissionFen === null ? null : allocate(commissionFen, rows.map(row => row.baseFen ?? 0));
  const totalFen = baseFen !== null && commissionFen !== null ? add([baseFen, commissionFen]) : null;
  return { productsFen, chinaFen, commissionFen, totalFen, lines: rows.map((row, index) => {
    const share = shares?.[index] ?? null;
    const goodsCents = row.baseFen !== null && share !== null && rate !== null && rate > 0 ? rounded((BigInt(row.baseFen) + BigInt(share)) * BigInt(rate), 10000n) : null;
    const batchCents = goodsCents !== null && row.freightCents !== null ? add([goodsCents, row.freightCents]) : null;
    const unitCostCents = row.received && batchCents !== null ? rounded(BigInt(batchCents) * 1000n, BigInt(row.received)) : null;
    return { ...row, commissionFen: share, goodsCents, batchCents, unitCostCents };
  }) };
}
