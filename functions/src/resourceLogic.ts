export interface StockValue { quantityMilli: number; valueCents: number | null }
export function integer(value: unknown, min = 0, max = 1e12): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Некорректное количество или сумма');
  return value;
}
function ratio(value: number, part: number, total: number): number {
  const denominator = BigInt(total);
  return Number((BigInt(value) * BigInt(part) * 2n + denominator) / (denominator * 2n));
}
function validate(stock: StockValue) { integer(stock.quantityMilli); if(stock.valueCents !== null) integer(stock.valueCents); }
export function receiveStock(before: StockValue, quantity: number, cost: number | null): StockValue {
  validate(before); integer(quantity,1); if(cost !== null) integer(cost);
  const quantityMilli = integer(before.quantityMilli + quantity);
  const valueCents = cost === null || before.quantityMilli > 0 && before.valueCents === null ? null : integer((before.quantityMilli ? before.valueCents! : 0) + cost);
  return { quantityMilli, valueCents };
}
export function consumeStock(before: StockValue, quantity: number): StockValue & { costCents: number | null } {
  validate(before); integer(quantity,1);
  if(quantity > before.quantityMilli) throw new Error('Недостаточно материала на складе');
  const costCents = before.valueCents === null ? null : ratio(before.valueCents, quantity, before.quantityMilli);
  return {quantityMilli:before.quantityMilli-quantity,valueCents:quantity===before.quantityMilli?0:costCents===null?null:before.valueCents!-costCents,costCents};
}
export function returnCost(originalCost: number | null, originalQuantity: number, alreadyReturned: number, quantity: number): number | null {
  integer(originalQuantity,1); integer(alreadyReturned); integer(quantity,1);
  if(alreadyReturned+quantity>originalQuantity) throw new Error('Возврат превышает расход');
  if(originalCost===null)return null; integer(originalCost);
  return ratio(originalCost,alreadyReturned+quantity,originalQuantity)-ratio(originalCost,alreadyReturned,originalQuantity);
}
export function laborCost(minutes: number, hourlyCents: number | null): number | null {
  integer(minutes,0,1440); if(minutes===0)return 0; if(hourlyCents===null)return null; integer(hourlyCents);
  return integer(ratio(hourlyCents,minutes,60));
}
