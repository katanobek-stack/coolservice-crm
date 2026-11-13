import { useRef, useState, type FormEvent } from 'react';
import type { ProcurementCatalogItem, ProcurementGroup, CatalogMergeInput } from '../../shared/types/procurement';
import type { MaterialItem } from '../../shared/types/resources';
import { mergeProcurementCatalog } from '../../shared/firebase/procurement';
import { Modal } from '../../shared/ui/Modal';
import { safeSupplierUrl } from './procurementLogic';

export function CatalogMergeDialog({ items, groups, materials, materialsReady, onClose, onSaved }: { items: ProcurementCatalogItem[]; groups: ProcurementGroup[]; materials: MaterialItem[]; materialsReady: boolean; onClose: () => void; onSaved: () => void }) {
  const initial = items[0];
  const [primaryId, setPrimaryId] = useState(initial.id), [photoId, setPhotoId] = useState(initial.id);
  const [name, setName] = useState(/^Товар\s+(?:Taobao|Tmall|1688|Alibaba)\s+\d+$/i.test(initial.name) ? '' : initial.name), [variant, setVariant] = useState(initial.variant), [confirmed, setConfirmed] = useState(false), [renameMaterial, setRenameMaterial] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [zoom, setZoom] = useState<ProcurementCatalogItem | null>(null);
  const [mergeId] = useState(() => crypto.randomUUID()), pending = useRef({ key: '', id: '' });
  const [group] = useState(() => groups.find(group => group.id === initial.groupId && group.active));
  const stockIds = [...new Set(items.map(item => item.linkedMaterialId).filter(Boolean))];
  const [stock] = useState(() => materials.find(item => item.id === stockIds[0]));
  const blocked = !group || items.some(item => item.groupId !== initial.groupId || item.archived || item.mergedIntoId) ? 'Выберите действующие товары внутри одной группы.' : stockIds.length > 1 ? 'У выбранных товаров разные складские позиции. Их остатки нельзя объединить этой кнопкой.' : stockIds.length && !stock ? 'Связанная складская позиция недоступна. Дождитесь загрузки или проверьте связь.' : '';
  const supplierCount = new Set(items.flatMap(item => item.suppliers.map(supplier => supplier.url))).size;
  function changePrimary(id: string) {
    const next = items.find(item => item.id === id)!;
    setPrimaryId(id); setPhotoId(id); setName(/^Товар\s+(?:Taobao|Tmall|1688|Alibaba)\s+\d+$/i.test(next.name) ? '' : next.name); setVariant(next.variant); setConfirmed(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || blocked || !group || !confirmed || !materialsReady) return;
    const input: CatalogMergeInput = { mergeId, primaryId, photoId, items: items.map(item => ({ id: item.id, revision: item.revision ?? 1 })), groupId: group.id, expectedGroupRevision: group.revision, name: name.trim(), variant: variant.trim(), confirmed, renameMaterial, ...(stock ? { expectedMaterialRevision: stock.revision } : {}) };
    const key = JSON.stringify(input); if (pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await mergeProcurementCatalog(pending.current.id, input); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось объединить товары'); }
    finally { setBusy(false); }
  }
  return <><Modal className="procurement-dialog procurement-merge-dialog" title="Сравнить и объединить товары" onClose={() => { if (!busy) onClose(); }}>
    <form className="materials-form" onSubmit={event => void submit(event)}><fieldset className="procurement-fieldset" disabled={busy}>
      <p className="materials-help">Группа: <strong>{group?.name ?? 'Не найдена'}</strong>. Останется одна карточка и {supplierCount} ссылок покупки. История, старые заказы и остатки сохранятся. Объединение подтверждайте только для одной модификации.</p>
      <div className="procurement-merge-comparison">{items.map(item => <article key={item.id}>
        {item.imageDataUrl ? <button type="button" className="procurement-merge-photo" aria-label={`Увеличить фото сравнения: ${item.name}`} onClick={() => setZoom(item)}><img src={item.imageDataUrl} alt={item.name} /></button> : <span className="procurement-no-photo">Фото не указано</span>}
        <h3>{item.name}</h3><p>{item.variant || 'Модификация не указана'}</p><p className="procurement-caption">{item.sources.length} записей закупки · {item.linkedMaterialId ? 'Связан со складом' : 'Складская позиция не создана'}</p>
        <label className="materials-check"><input type="radio" name="primary-card" value={item.id} checked={primaryId === item.id} onChange={() => changePrimary(item.id)} />Основная карточка</label>
        <details><summary>Ссылки и история</summary>{item.suppliers.map(supplier => safeSupplierUrl(supplier.url) && <p key={supplier.url}><a href={supplier.url} target="_blank" rel="noopener noreferrer">{supplier.site} · {supplier.product}</a>{supplier.disabled && ' · Не использовать'}{supplier.priceFen !== null && ` · ${supplier.priceFen / 100} ¥`}</p>)}{item.sources.map((source, index) => <p key={index}>{source.file}, строка {source.row} · {source.description || 'Модификация не указана'} · {source.quantity} · {source.priceFen === null ? 'Цена неизвестна' : source.priceFen / 100 + ' ¥'}</p>)}</details>
      </article>)}</div>
      {blocked && <p role="alert" className="materials-notice materials-error">{blocked}</p>}
      <label>Понятное название товара<input aria-label="Единое название товара" required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Точная модификация<textarea aria-label="Единая модификация" maxLength={1000} rows={2} value={variant} onChange={event => setVariant(event.target.value)} /></label>
      <label>Основное фото<select aria-label="Основное фото товара" value={photoId} onChange={event => setPhotoId(event.target.value)}>{items.map(item => <option key={item.id} value={item.id}>{item.name}{item.imageDataUrl ? '' : ' · Без фото'}</option>)}</select></label>
      <p className="materials-help">Одинаковые ссылки объединятся. При разных исторических ценах одной ссылки используется цена основной карточки; исходные данные сохраняются. Перед следующим закупом проверьте актуальную цену.</p>
      {stock ? <><p className="materials-help">Позиция на складе: <strong>{stock.name}</strong>. Остаток и стоимость не меняются.</p><label className="materials-check"><input type="checkbox" checked={renameMaterial} onChange={event => setRenameMaterial(event.target.checked)} />Применить единое название на складе для новых записей расхода</label></> : !stockIds.length && <p className="materials-help">После объединения создайте или свяжите складскую позицию с этим названием. Механики выбирают расход из складских позиций с подтверждённым наличием.</p>}
      <label className="materials-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Подтверждаю: товары одной модификации или полностью взаимозаменяемы для нашего учёта</label>
      {error && <p role="alert" className="materials-notice materials-error">{error}</p>}
      <div className="materials-form-footer"><button type="button" className="materials-btn" onClick={onClose}>Отмена</button><button type="submit" className="materials-btn materials-primary" disabled={!confirmed || !!blocked || !materialsReady}>{busy ? 'Объединяем…' : 'Объединить товары'}</button></div>
    </fieldset></form>
  </Modal>{zoom && <Modal className="procurement-dialog procurement-photo-dialog" title={zoom.name} onClose={() => setZoom(null)}><img src={zoom.imageDataUrl} alt={zoom.name} /><p>{zoom.variant}</p></Modal>}</>;
}
