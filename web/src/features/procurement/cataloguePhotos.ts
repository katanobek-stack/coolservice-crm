import type { ProcurementCatalogItem } from '../../shared/types/procurement';
import type { PhotoFingerprint } from './catalogueSimilarity';

async function fingerprint(source: string): Promise<PhotoFingerprint | null> {
  if (!source.startsWith('data:image/')) return null;
  const img = new Image(); img.src = source;
  try { await img.decode(); } catch { return null; }
  const canvas = document.createElement('canvas'); canvas.width = 9; canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context || !img.naturalHeight) return null;
  context.fillStyle = '#fff'; context.fillRect(0, 0, 9, 8); context.drawImage(img, 0, 0, 9, 8);
  const data = context.getImageData(0, 0, 9, 8).data;
  const gray = Array.from({ length: 72 }, (_, index) => data[index * 4] * .299 + data[index * 4 + 1] * .587 + data[index * 4 + 2] * .114);
  const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
  if (gray.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gray.length < 64) return null;
  let hash = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash = (hash << 1n) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1n : 0n);
  return { hash: hash.toString(16).padStart(16, '0'), ratio: img.naturalWidth / img.naturalHeight };
}
export async function scanCataloguePhotos(items: ProcurementCatalogItem[], progress: (done: number) => void, cancelled: () => boolean) {
  const bySource = new Map<string, PhotoFingerprint | null>(), result = new Map<string, PhotoFingerprint>();
  for (let index = 0; index < items.length; index++) {
    if (cancelled()) break;
    const item = items[index];
    if (item.imageDataUrl) {
      if (!bySource.has(item.imageDataUrl)) bySource.set(item.imageDataUrl, await fingerprint(item.imageDataUrl));
      const value = bySource.get(item.imageDataUrl); if (value) result.set(item.id, { ...value, source: item.imageDataUrl });
    }
    if (index % 12 === 0 || index === items.length - 1) { progress(index + 1); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  return result;
}
