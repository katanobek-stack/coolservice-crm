import { useState, type FormEvent } from 'react';
import type { ProcurementCatalogItem } from '../../shared/types/procurement';
import type { MaterialItem, MaterialUnit } from '../../shared/types/resources';
import { linkProcurementMaterial } from '../../shared/firebase/procurement';
import { Modal } from '../../shared/ui/Modal';
import { materialUnits, resourceNumber } from '../materials/materialsLogic';

export function StockLinkForm({ item, materials, onClose, onSaved }: { item: ProcurementCatalogItem; materials: MaterialItem[]; onClose: () => void; onSaved: () => void }) {
  const [existing, setExisting] = useState(''), [name, setName] = useState(item.name.slice(0, 160)), [unit, setUnit] = useState<MaterialUnit | ''>('');
  const [minimum, setMinimum] = useState('0'), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const minimumMilli = resourceNumber(minimum, 1000), material = materials.find(value => value.id === existing);
    if ((!existing && (!name.trim() || !unit || minimumMilli === null || (unit === 'pcs' && minimumMilli % 1000 !== 0))) || (item.needsReview && !reviewed)) { setError('Укажите название, единицу и минимум. Для спорного товара подтвердите проверку модификации.'); return; }
    setBusy(true); setError('');
    try {
      await linkProcurementMaterial(requestId, { catalogId: item.id, expectedCatalogRevision: item.revision ?? 1, reviewed, ...(material ? { materialId: material.id, expectedMaterialRevision: material.revision } : { name: name.trim(), unit: unit as MaterialUnit, minimumMilli: minimumMilli! }) });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сформировать позицию склада'); } finally { setBusy(false); }
  }
  return <Modal title="Сформировать позицию склада" onClose={() => { if (!busy) onClose(); }}><form className="materials-form" onSubmit={event => void submit(event)}>
    <strong>{item.name}</strong>{item.imageDataUrl && <img className="procurement-link-image" src={item.imageDataUrl} alt="Товар из исходного заказа" />}
    <label>Позиция склада<select value={existing} onChange={event => setExisting(event.target.value)}><option value="">Создать новую позицию</option>{materials.filter(value => value.active).map(value => <option key={value.id} value={value.id}>{value.name} · {materialUnits[value.unit]}</option>)}</select></label>
    {!existing && <><label>Название на складе<input aria-label="Название на складе" required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label><label>Единица измерения<select aria-label="Единица складской позиции" required value={unit} onChange={event => setUnit(event.target.value as MaterialUnit)}><option value="">Выберите единицу</option>{Object.entries(materialUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Минимальный остаток<input inputMode="decimal" required value={minimum} onChange={event => setMinimum(event.target.value)} /></label><p className="materials-help">После создания остаток ещё не указан. В «Складе» нажмите «Сверить остаток» и внесите фактическое количество. Исторические закупки не переносятся в наличие.</p></>}
    {item.needsReview && <><p className="materials-help">{item.reviewNote || 'В исходных файлах модификация описана неполно.'}</p><label className="materials-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Я проверил товар, модификацию и единицу учёта</label></>}
    {error && <p role="alert" className="materials-notice materials-error">{error}</p>}<div className="materials-form-footer"><button className="materials-btn" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="materials-btn materials-primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : existing ? 'Связать со складом' : 'Создать позицию склада'}</button></div>
  </form></Modal>;
}
