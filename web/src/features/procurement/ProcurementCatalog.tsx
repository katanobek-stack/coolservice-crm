import { useEffect, useRef, useState } from 'react';
import type { CatalogMutation, ProcurementCatalogItem, ProcurementGroup } from '../../shared/types/procurement';
import type { MaterialItem } from '../../shared/types/resources';
import { initializeProcurementGroups, saveProcurementGroup, deleteProcurementGroup, updateProcurementCatalog } from '../../shared/firebase/procurement';
import { Modal } from '../../shared/ui/Modal';
import { catalogGroupCounts, catalogViewItems } from './catalogLogic';
import { safeSupplierUrl } from './procurementLogic';
import { CatalogDialog, type CatalogDialogSpec } from './CatalogDialog';

const fen = (value: number | null) => value === null ? 'Не указана' : (value / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ¥';
interface Props {
  items: ProcurementCatalogItem[]; groups: ProcurementGroup[]; materials: MaterialItem[];
  ready: boolean; busy: boolean; materialsReady: boolean; selectedForOrder: Set<string>;
  pick: (item: ProcurementCatalogItem) => void; link: (item: ProcurementCatalogItem) => void;
}
export function ProcurementCatalog({ items, groups, materials, ready, busy, materialsReady, selectedForOrder, pick, link }: Props) {
  const [view, setView] = useState('all'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(1);
  const [sorting, setSorting] = useState(false), [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [dialog, setDialog] = useState<CatalogDialogSpec | null>(null), [photo, setPhoto] = useState<ProcurementCatalogItem | null>(null);
  const pending = useRef({ key: '', id: '' }), attemptedInit = useRef(false);
  const disabled = busy || saving || !ready, trash = view === 'trash', selecting = sorting || trash;
  const activeGroups = groups.filter(group => group.active).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ru'));
  const currentGroup = activeGroups.find(group => group.id === view), counts = catalogGroupCounts(items, groups);
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const filtered = catalogViewItems(items, groups, view).filter(item =>
    (!needle || `${item.name} ${item.variant} ${item.suppliers.map(s => s.product + ' ' + s.url).join(' ')} ${item.sources.map(s => s.file).join(' ')}`.toLocaleLowerCase('ru-RU').includes(needle)) &&
    (filter === 'all' || filter === 'review' && item.needsReview || filter === 'unlinked' && !item.linkedMaterialId || filter === 'low' && materials.some(material => material.id === item.linkedMaterialId && material.active && material.stockConfirmed !== false && material.quantityMilli <= material.minimumMilli))
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20)), safePage = Math.min(page, pageCount), visible = filtered.slice((safePage - 1) * 20, safePage * 20);
  useEffect(() => { setSelection(new Map()); }, [view, search, filter, safePage, sorting]);
  useEffect(() => { if (ready && !['all', 'ungrouped', 'trash'].includes(view) && !groups.some(group => group.id === view && group.active)) { setView('ungrouped'); setPage(1); } }, [groups, view, ready]);
  useEffect(() => {
    if (!ready || groups.length || attemptedInit.current) return;
    attemptedInit.current = true;
    void initializeProcurementGroups(crypto.randomUUID()).catch(e => setError(e instanceof Error ? e.message : 'Не удалось создать начальные группы'));
  }, [ready, groups.length]);

  async function run(kind: string, payload: object, request: (id: string) => Promise<unknown>) {
    const key = JSON.stringify({ kind, payload });
    if (pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() };
    setSaving(true); setError(''); setNotice('');
    try { await request(pending.current.id); pending.current = { key: '', id: '' }; setSelection(new Map()); setNotice('Изменения сохранены.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить изменения'); throw e; }
    finally { setSaving(false); }
  }
  const refs = () => [...selection].map(([id, revision]) => ({ id, revision }));
  const mutate = (payload: CatalogMutation) => run('updateCatalog', payload, id => updateProcurementCatalog(id, payload));
  function move(groupId: string, item?: ProcurementCatalogItem) {
    if (groupId === 'ungrouped-choice') groupId = '';
    const selected = item ? [{ id: item.id, revision: item.revision ?? 1 }] : refs();
    if (!selected.length || disabled) return;
    void mutate({ operation: 'move', items: selected, groupId }).catch(() => {});
  }
  function choose(item: ProcurementCatalogItem) {
    if (!selection.has(item.id) && selection.size >= 100) { setError('За один раз можно выбрать до 100 товаров.'); return; }
    setSelection(previous => { const next = new Map(previous); if (next.has(item.id)) next.delete(item.id); else next.set(item.id, item.revision ?? 1); return next; });
  }
  function editGroup(group?: ProcurementGroup) {
    const id = group?.id ?? crypto.randomUUID(), expectedRevision = group?.revision ?? 0;
    setDialog({ title: group ? 'Переименовать группу' : 'Новая группа', name: group?.name ?? '', submit: 'Сохранить', save: async name => { const payload = { id, expectedRevision, name }; await run('saveGroup', payload, requestId => saveProcurementGroup(requestId, payload)); } });
  }
  function editItem(item: ProcurementCatalogItem) {
    setDialog({ title: 'Название товара', name: item.name, variant: item.variant, message: 'Изменение названия не меняет ранее сохранённые заказы и название связанной складской позиции.', submit: 'Сохранить', save: async (name, variant) => { await mutate({ operation: 'rename', items: [{ id: item.id, revision: item.revision ?? 1 }], name, variant }); } });
  }
  function removeGroup(group: ProcurementGroup) {
    const payload = { id: group.id, expectedRevision: group.revision };
    setDialog({ title: 'Удалить группу «' + group.name + '»?', message: 'Все товары этой группы останутся в каталоге и будут показаны в «Без группы». Товары в корзине сохранятся в корзине. Заказы и остатки не изменятся.', submit: 'Удалить группу', save: async () => { await run('deleteGroup', payload, requestId => deleteProcurementGroup(requestId, payload)); setView('ungrouped'); } });
  }
  function basket() {
    const selected = refs(); if (!selected.length) return;
    setDialog({ title: 'Убрать товары в корзину?', message: `Выбрано: ${selected.length}. Можно восстановить позже. История закупок, заказы и складские остатки сохранятся.`, submit: 'В корзину', save: async () => { await mutate({ operation: 'trash', items: selected }); } });
  }
  const navigate = (id: string) => { setView(id); setPage(1); };
  const groupButton = (id: string, name: string) => <button key={id} type="button" disabled={disabled} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><span>{name}</span><span>{counts[id] ?? 0}</span></button>;
  return <div className="procurement-sort-layout">
    <aside className="procurement-groups" aria-label="Группы товаров">
      <strong>Группы товаров</strong>{groupButton('all', 'Все товары')}{groupButton('ungrouped', 'Без группы')}
      <div className="procurement-group-divider" />{activeGroups.map(group => groupButton(group.id, group.name))}
      <button type="button" className="procurement-add-group" disabled={disabled} onClick={() => editGroup()}>+ Новая группа</button>
      <div className="procurement-group-divider" />{groupButton('trash', 'Корзина')}
    </aside>
    <section className="materials-panel procurement-catalog-panel">
      <header><div><h2>{currentGroup?.name ?? (view === 'ungrouped' ? 'Без группы' : trash ? 'Корзина' : 'Товары из заказов')}</h2><p>{trash ? 'Убраны из каталога. История и складские связи сохранены.' : sorting ? 'Отмечайте товары и переносите в группу одной кнопкой. Выбор для заказа остаётся отдельным.' : 'Цены исторические. Для распределения товаров включите «Разобрать каталог».'}</p></div>
        <div className="materials-actions">{currentGroup && <><button className="materials-btn" disabled={disabled} onClick={() => editGroup(currentGroup)}>Переименовать группу</button><button className="materials-link" disabled={disabled} onClick={() => removeGroup(currentGroup)}>Удалить группу</button></>}{!trash && <button type="button" className={`materials-btn ${sorting ? 'materials-primary' : ''}`} disabled={disabled} onClick={() => setSorting(!sorting)}>{sorting ? 'Завершить разбор' : 'Разобрать каталог'}</button>}</div>
      </header>
      {error && <p role="alert" className="materials-notice materials-error">{error}</p>}{notice && <p role="status" className="materials-notice materials-success">{notice}</p>}
      <div className="materials-filters"><label>Поиск<input type="search" aria-label="Найти товар для закупа" value={search} placeholder="Название, модель, ссылка или заказ" onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><label>Показать<select aria-label="Фильтр каталога закупа" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">Все товары</option><option value="unlinked">Ещё не связаны со складом</option><option value="low">Заканчиваются на складе</option><option value="review">Нужно уточнить модификацию</option></select></label><span className="procurement-caption">Найдено: {filtered.length}</span></div>
      {selecting && <fieldset disabled={disabled} className="procurement-fieldset procurement-selection-toolbar"><div className="procurement-selection-count">Выбрано: <strong>{selection.size}</strong> / 100</div><button className="materials-btn" onClick={() => setSelection(new Map(visible.map(item => [item.id, item.revision ?? 1])))}>Выбрать видимые</button><button className="materials-link" onClick={() => setSelection(new Map())}>Снять выбор</button>
        {trash ? <button className="materials-btn materials-primary" disabled={!selection.size} onClick={() => void mutate({ operation: 'restore', items: refs() }).catch(() => {})}>Восстановить выбранные</button> : <><label>Перенести в группу<select aria-label="Перенести выбранные в группу" value="" disabled={!selection.size} onChange={event => move(event.target.value)}><option value="" disabled>Выберите группу</option><option value="ungrouped-choice">Без группы</option>{activeGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button className="materials-link procurement-danger" disabled={!selection.size} onClick={basket}>В корзину</button></>}
      </fieldset>}
      <fieldset disabled={disabled} className="procurement-fieldset"><div className="procurement-catalog">{visible.map(item => {
        const material = materials.find(value => value.id === item.linkedMaterialId), group = activeGroups.find(value => value.id === item.groupId);
        return <article key={item.id} className={`procurement-card ${(selecting ? selection.has(item.id) : selectedForOrder.has(item.id)) ? 'procurement-selected' : ''}`}>
          <div className="procurement-card-top">{item.imageDataUrl ? <button type="button" className="procurement-photo-button" aria-label={`Увеличить фото: ${item.name}`} onClick={() => setPhoto(item)}><img loading="lazy" src={item.imageDataUrl} alt="Фото товара из заказа" /></button> : <span className="procurement-no-photo">Фото позже</span>}
            {selecting ? <label className="materials-check"><input type="checkbox" aria-label={`Разобрать: ${item.name}`} checked={selection.has(item.id)} onChange={() => choose(item)} />Выбрать</label> : <label className="materials-check"><input type="checkbox" aria-label={`В заказ: ${item.name}`} checked={selectedForOrder.has(item.id)} onChange={() => pick(item)} />В заказ</label>}
          </div><span className="procurement-group-tag">{group?.name ?? 'Без группы'}</span><h3>{item.name}</h3>{item.variant !== item.name && <p className="procurement-variant">{item.variant}</p>}{item.needsReview && <span className="materials-tag warning">Уточнить модификацию</span>}
          <p className="procurement-caption">Последняя цена: {fen(item.suppliers[0]?.priceFen ?? null)}</p><div className="procurement-suppliers">{item.suppliers.map(supplier => safeSupplierUrl(supplier.url) && <a key={supplier.url} href={safeSupplierUrl(supplier.url)!} target="_blank" rel="noopener noreferrer">{supplier.site} · {supplier.product} ↗</a>)}</div>
          <details><summary>История закупок · {item.sources.length}</summary>{item.reviewNote && <p className="procurement-caption">{item.reviewNote}</p>}<ul>{item.sources.map((source, index) => <li key={index}>{source.file}, строка {source.row}<br />{source.description || 'Модификация не указана'} · {source.quantity || 'Количество не указано'} · {fen(source.priceFen)}</li>)}</ul></details>
          <div className="procurement-card-footer">{!trash && <><button className="materials-link" onClick={() => editItem(item)}>Изменить название</button>{!sorting && <label className="procurement-quick-move">Переместить<select aria-label={`Группа товара: ${item.name}`} value={group?.id ?? ''} onChange={event => move(event.target.value, item)}><option value="">Без группы</option>{activeGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}</>}
            {material ? <p className="procurement-caption">На складе: {material.name}<br />{material.stockConfirmed === false ? 'Остаток ещё не указан' : `Остаток: ${(material.quantityMilli / 1000).toLocaleString('ru-RU')}`}</p> : !trash && <button type="button" className="materials-btn" disabled={!materialsReady} onClick={() => link(item)}>Сформировать позицию склада</button>}
          </div>
        </article>;
      })}</div></fieldset>
      {ready && !visible.length && <p className="materials-empty">{trash ? 'Корзина пуста.' : 'В этой группе нет товаров по выбранному фильтру.'}</p>}
      <div className="procurement-pagination"><button className="materials-btn" disabled={disabled || safePage <= 1} onClick={() => setPage(safePage - 1)}>Назад</button><span>{safePage} / {pageCount}</span><button className="materials-btn" disabled={disabled || safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Далее</button></div>
    </section>
    {dialog && <CatalogDialog spec={dialog} onClose={() => setDialog(null)} />}
    {photo && <Modal className="procurement-dialog procurement-photo-dialog" title={photo.name} onClose={() => setPhoto(null)}><img src={photo.imageDataUrl} alt={photo.name} /><p>{photo.variant}</p></Modal>}
  </div>;
}
