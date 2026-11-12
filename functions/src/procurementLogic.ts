import { createHash } from 'node:crypto';

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные данные'); return value as Record<string, unknown>; }
export function procurementId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Некорректный идентификатор'); return value; }
function text(value: unknown, max: number, empty = true): string { if (typeof value !== 'string' || value.trim().length > max || (!empty && !value.trim())) throw new Error('Некорректный текст'); return value.trim(); }
function integer(value: unknown, max = 1e12): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('Некорректная сумма или количество'); return value; }
export function supplierUrl(value: unknown): string {
  const source = text(value, 2500, false), url = new URL(source);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['taobao.com', 'tmall.com', '1688.com', 'alibaba.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('Недопустимая ссылка поставщика');
  return url.href;
}
function price(value: unknown) { return value === null ? null : integer(value); }
function decimal(value: unknown, places: number, allowEmpty = true, positive = false): string {
  const result = text(value, 24);
  if (!result && allowEmpty) return result;
  if (!new RegExp(`^\\d+(?:[.,]\\d{1,${places}})?$`).test(result) || !Number.isFinite(Number(result.replace(',', '.'))) || Number(result.replace(',', '.')) > 1e9 || (positive && Number(result.replace(',', '.')) <= 0)) throw new Error('Некорректное число');
  return result;
}
export function validateCatalogItem(value: unknown) {
  const x = object(value);
  if (!Array.isArray(x.suppliers) || !x.suppliers.length || x.suppliers.length > 20 || !Array.isArray(x.sources) || !x.sources.length || x.sources.length > 100) throw new Error('Нужны ссылки покупки и история источников');
  const imageDataUrl = text(x.imageDataUrl, 32000);
  if (imageDataUrl && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)) throw new Error('Некорректная фотография');
  if (typeof x.needsReview !== 'boolean') throw new Error('Укажите состояние проверки');
  return { id: procurementId(x.id), name: text(x.name, 160, false), variant: text(x.variant, 1000), suppliers: x.suppliers.map(value => { const s = object(value); return { url: supplierUrl(s.url), site: text(s.site, 40, false), product: text(s.product, 128), priceFen: price(s.priceFen) }; }), sources: x.sources.map(value => { const s = object(value); const year = text(s.year, 4, false); if (!/^20\d{2}$/.test(year) || integer(s.row, 1000000) < 1) throw new Error('Некорректный источник'); return { file: text(s.file, 200, false), row: s.row as number, year, quantity: text(s.quantity, 80), priceFen: price(s.priceFen), description: text(s.description, 1000) }; }), imageDataUrl, needsReview: x.needsReview, reviewNote: text(x.reviewNote, 2000) };
}
export function validateOrder(value: unknown) {
  const x = object(value);
  if (!Array.isArray(x.lines) || !x.lines.length || x.lines.length > 200) throw new Error('Выберите от 1 до 200 позиций');
  const commission = decimal(x.commission, 2, false);
  if (Number(commission.replace(',', '.')) > 100) throw new Error('Комиссия должна быть от 0 до 100%');
  const lines = x.lines.map(value => { const s = object(value); return { catalogId: procurementId(s.catalogId), name: text(s.name, 160, false), variant: text(s.variant, 1000), supplierUrl: supplierUrl(s.supplierUrl), quantity: decimal(s.quantity, 3, false, true), unitPrice: decimal(s.unitPrice, 2), chinaDelivery: decimal(s.chinaDelivery, 2), receivedQuantity: decimal(s.receivedQuantity, 3), weightKg: decimal(s.weightKg, 3) }; });
  if (new Set(lines.map(line => line.catalogId)).size !== lines.length) throw new Error('Позиция повторяется в заказе');
  return { id: procurementId(x.id), name: text(x.name, 160, false), commission, exchange: decimal(x.exchange, 4, true, true), freightRate: decimal(x.freightRate, 2), lines };
}
export function materialIdForCatalog(id: string): string { return createHash('sha256').update('procurement:' + procurementId(id)).digest('hex').slice(0, 40); }
export function assertStockConfirmed(item: { stockConfirmed?: boolean }) { if (item.stockConfirmed === false) throw new Error('Сначала сверьте фактический остаток этой позиции'); }
export function canManageProcurement(role: string | undefined, financial: boolean | undefined, ownerClaim: boolean): boolean { return ownerClaim || role === 'owner' || (['admin', 'manager'].includes(role ?? '') && financial !== false); }
