import type { ProcurementCatalogItem, ProcurementGroup } from '../../shared/types/procurement';

export interface PhotoFingerprint { hash: string; ratio: number; source?: string }
export interface SimilarCatalogPair { key: string; groupId: string; items: [ProcurementCatalogItem, ProcurementCatalogItem]; reasons: string[]; score: number; differentVariants: boolean }
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
function informative(text: string) { return normalize(text).replace(/товар\s*(?:taobao|1688|tmall|alibaba)?\s*\d*/g, '').replace(/модификация не указана/g, '').trim(); }
function numericSignature(item: ProcurementCatalogItem) { return [...new Set((informative(item.name + ' ' + item.variant).match(/\d+(?:[.,]\d+)?/g) ?? []).map(value => String(Number(value.replace(',', '.')))))].sort().join('|'); }
function purchaseKey(source: string) {
  try { const url = new URL(source); for (const name of [...url.searchParams.keys()]) if (/^(spm|scm|utm_.+|ali_trackid|ut_sk|utparam)$/i.test(name)) url.searchParams.delete(name); url.searchParams.sort(); return url.href; } catch { return source; }
}
function nearPhotos(a: PhotoFingerprint | undefined, b: PhotoFingerprint | undefined) {
  if (!a || !b || a.ratio / b.ratio < .85 || a.ratio / b.ratio > 1.18) return false;
  let bits = BigInt('0x' + a.hash) ^ BigInt('0x' + b.hash), distance = 0;
  while (bits && distance <= 5) { bits &= bits - 1n; distance++; }
  return distance <= 5;
}
export function findSimilarCatalogItems(items: ProcurementCatalogItem[], groups: ProcurementGroup[], photos: ReadonlyMap<string, PhotoFingerprint> = new Map()): SimilarCatalogPair[] {
  const active = new Set(groups.filter(group => group.active).map(group => group.id));
  const candidates = items.filter(item => !item.archived && !item.mergedIntoId && item.groupId && active.has(item.groupId));
  const prepared = candidates.map(item => ({ item, numbers: numericSignature(item), links: new Set(item.suppliers.map(supplier => purchaseKey(supplier.url))), words: new Set((informative(item.name + ' ' + item.variant).match(/[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)*/gu) ?? []).filter(word => word.length > 1)) }));
  const pairs: SimilarCatalogPair[] = [];
  for (let i = 0; i < prepared.length; i++) for (let j = i + 1; j < prepared.length; j++) {
    const a = prepared[i], b = prepared[j]; if (a.item.groupId !== b.item.groupId) continue;
    if (a.numbers && b.numbers && a.numbers !== b.numbers) continue;
    const reasons: string[] = []; let score = 0;
    if ([...a.links].some(link => b.links.has(link))) { reasons.push('Одинаковая ссылка'); score += 65; }
    if (a.item.imageDataUrl && a.item.imageDataUrl === b.item.imageDataUrl) { reasons.push('Одинаковое фото'); score += 75; }
    else if (nearPhotos(photos.get(a.item.id)?.source && photos.get(a.item.id)!.source !== a.item.imageDataUrl ? undefined : photos.get(a.item.id), photos.get(b.item.id)?.source && photos.get(b.item.id)!.source !== b.item.imageDataUrl ? undefined : photos.get(b.item.id))) { reasons.push('Похожие фото'); score += 55; }
    const common = [...a.words].filter(word => b.words.has(word)), union = new Set([...a.words, ...b.words]);
    const model = common.some(word => /\p{L}/u.test(word) && /\d/.test(word) && word.length >= 4 && !/^(?:ac|dc)?\d+(?:v|в|a|а|w|вт|mm|мм|cm|см|m|м|kg|кг)$/i.test(word) && !/^r\d{2,4}[a-z]?$/i.test(word));
    if (common.length >= 2 && union.size && common.length / union.size >= .65 || model) { reasons.push(model ? 'Совпадает модель' : 'Похожие названия'); score += model ? 65 : 55; }
    if (!reasons.length) continue;
    const va = informative(a.item.variant), vb = informative(b.item.variant);
    pairs.push({ key: [a.item.id, b.item.id].sort().join(':'), groupId: a.item.groupId!, items: [a.item, b.item], reasons, score, differentVariants: !!va && !!vb && va !== vb });
  }
  return pairs.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
