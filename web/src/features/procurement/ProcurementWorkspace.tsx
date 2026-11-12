import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ProcurementCatalogItem, ProcurementOrder, ProcurementOrderDraft } from '../../shared/types/procurement';
import type { MaterialItem } from '../../shared/types/resources';
import { importProcurementCatalog, saveProcurementOrder, useProcurement } from '../../shared/firebase/procurement';
import { calculateProcurement, parseDecimal, safeSupplierUrl } from './procurementLogic';
import { ProcurementOrderEditor } from './ProcurementOrderEditor';
import { StockLinkForm } from './StockLinkForm';
import { exportProcurementOrder } from './procurementExport';
import './procurement.css';

const freshOrder = (): ProcurementOrderDraft => ({ id: crypto.randomUUID(), name: 'Закуп · ' + new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Vladivostok' }).format(new Date()), commission: '3', exchange: '', freightRate: '', lines: [] });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить. Попробуйте ещё раз.';
const fen = (value: number | null) => value === null ? 'Не указана' : (value / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ¥';

function recoverOrder(key: string) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 1000000) return null;
    const value = JSON.parse(raw);
    const draft = value.draft;
    if (!draft || !['id', 'name', 'commission', 'exchange', 'freightRate'].every(field => typeof draft[field] === 'string') || !Array.isArray(draft.lines) || draft.lines.length > 200 || !draft.lines.every((line: Record<string, unknown>) => line && ['catalogId', 'name', 'variant', 'supplierUrl', 'quantity', 'unitPrice', 'chinaDelivery', 'receivedQuantity', 'weightKg'].every(field => typeof line[field] === 'string')) || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.saved !== 'string') return null;
    return value as { draft: ProcurementOrderDraft; revision: number; saved: string; pending?: { fingerprint: string; requestId: string } };
  } catch { return null; }
}

export function ProcurementWorkspace({ materials, materialsReady = true, ownerId }: { materials: MaterialItem[]; materialsReady?: boolean; ownerId: string }) {
  const data = useProcurement(), fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'catalog' | 'order'>('catalog'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(1);
  const storageKey = 'crm-procurement-draft:' + ownerId;
  const [initial] = useState(() => { const recovered = recoverOrder(storageKey); if (recovered) return recovered; const draft = freshOrder(); return { draft, revision: 0, saved: JSON.stringify(draft), pending: undefined }; });
  const [draft, setDraft] = useState(initial.draft), [revision, setRevision] = useState(initial.revision), [saved, setSaved] = useState(initial.saved);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState(''), [linking, setLinking] = useState<ProcurementCatalogItem | null>(null);
  const pendingSave = useRef(initial.pending && typeof initial.pending.fingerprint === 'string' && typeof initial.pending.requestId === 'string' ? initial.pending : { fingerprint: '', requestId: '' });
  const fingerprint = JSON.stringify(draft), dirty = fingerprint !== saved;
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, revision, saved, pending: pendingSave.current })); }
    catch { setError('Не удалось сохранить черновик в браузере. Сохраните заказ перед переходом в другой раздел.'); }
  }, [storageKey, draft, revision, saved]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const sync = () => { const recovered = recoverOrder(storageKey); if (recovered?.draft.id === draft.id && recovered.revision > revision) { setRevision(recovered.revision); setSaved(recovered.saved); pendingSave.current = { fingerprint: '', requestId: '' }; } };
    window.addEventListener('procurement-saved', sync); return () => window.removeEventListener('procurement-saved', sync);
  }, [storageKey, draft.id, revision]);
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const selected = new Set(draft.lines.map(line => line.catalogId));
  const filtered = data.items.filter(item => (!needle || `${item.name} ${item.variant} ${item.suppliers.map(supplier => supplier.product + ' ' + supplier.url).join(' ')} ${item.sources.map(source => source.file).join(' ')}`.toLocaleLowerCase('ru-RU').includes(needle)) && (filter === 'all' || filter === 'review' && item.needsReview || filter === 'unlinked' && !item.linkedMaterialId || filter === 'low' && materials.some(material => material.id === item.linkedMaterialId && material.active && material.stockConfirmed !== false && material.quantityMilli <= material.minimumMilli))).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20)), safePage = Math.min(page, pageCount), visible = filtered.slice((safePage - 1) * 20, safePage * 20);
  function pick(item: ProcurementCatalogItem) {
    if (selected.has(item.id)) { setDraft({ ...draft, lines: draft.lines.filter(line => line.catalogId !== item.id) }); return; }
    if (draft.lines.length >= 200) { setError('В одном заказе может быть до 200 позиций.'); return; }
    const supplier = item.suppliers[0];
    setDraft({ ...draft, lines: [...draft.lines, { catalogId: item.id, name: item.name, variant: item.variant, supplierUrl: supplier.url, quantity: '1', unitPrice: supplier.priceFen === null ? '' : String(supplier.priceFen / 100), chinaDelivery: '', receivedQuantity: '', weightKg: '' }] });
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Размер файла должен быть не больше 30 МБ.');
      const bundle: unknown = JSON.parse(await file.text());
      if (!bundle || typeof bundle !== 'object' || !('schema' in bundle) || bundle.schema !== 'coolservice-procurement-v1' || !('items' in bundle) || !Array.isArray(bundle.items) || !bundle.items.length || bundle.items.length > 10000) throw new Error('Нужен подготовленный файл каталога закупа CRM (.json).');
      const ids = new Set<string>();
      for (const item of bundle.items as ProcurementCatalogItem[]) {
        if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Array.isArray(item.suppliers) || !item.suppliers.length || item.suppliers.some(supplier => !safeSupplierUrl(supplier.url))) throw new Error('Файл содержит повторяющиеся ID или некорректные ссылки.');
        ids.add(item.id);
      }
      const run = crypto.randomUUID(); let imported = 0, skipped = 0;
      for (let index = 0; index < bundle.items.length; index += 25) {
        const result = await importProcurementCatalog(run + '_' + index, bundle.items.slice(index, index + 25));
        imported += result.imported ?? 0; skipped += result.skipped ?? 0;
        setNotice(`Загружаем каталог: ${Math.min(index + 25, bundle.items.length)} из ${bundle.items.length}`);
      }
      setNotice(`Каталог загружен: добавлено ${imported}, уже существовали ${skipped}. Остатки склада не изменены.`);
    } catch (e) { setNotice(''); setError(errorText(e) + ' Повторная загрузка того же файла безопасна: существующие позиции сохраняются.'); } finally { setBusy(false); }
  }
  async function save() {
    if (busy) return; setError(''); setNotice('');
    if (!draft.lines.length || !draft.name.trim() || parseDecimal(draft.commission, 100) === null || (parseDecimal(draft.commission, 100) ?? 10001) > 10000 || draft.lines.some(line => !parseDecimal(line.quantity, 1000) || !safeSupplierUrl(line.supplierUrl))) { setError('Проверьте название, комиссию, ссылки и положительное количество каждой позиции.'); return; }
    const key = JSON.stringify({ draft, revision });
    if (pendingSave.current.fingerprint !== key) pendingSave.current = { fingerprint: key, requestId: crypto.randomUUID() };
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, revision, saved, pending: pendingSave.current })); } catch { /* The server can still save when browser storage is unavailable. */ }
    setBusy(true);
    try { const result = await saveProcurementOrder(pendingSave.current.requestId, draft, revision); const recovered = recoverOrder(storageKey); if (recovered?.draft.id === draft.id && recovered.revision <= result.revision!) { try { sessionStorage.setItem(storageKey, JSON.stringify({ ...recovered, revision: result.revision!, saved: fingerprint, pending: undefined })); window.dispatchEvent(new Event('procurement-saved')); } catch { /* The mounted editor still receives the server result. */ } } setRevision(result.revision!); setSaved(fingerprint); setNotice('Заказ сохранён. ДДС и складские остатки не изменены.'); pendingSave.current = { fingerprint: '', requestId: '' }; }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function exportOrder() {
    setError('');
    const calculated = calculateProcurement(draft.lines, draft);
    if (calculated.totalFen === null || draft.lines.some(line => !safeSupplierUrl(line.supplierUrl))) { setError('Перед выгрузкой заполните количество, цену и доставку по Китаю каждой позиции, а также комиссию.'); return; }
    try { exportProcurementOrder(draft); } catch (e) { setError(errorText(e)); }
  }
  function openOrder(order?: ProcurementOrder) {
    if (busy) return;
    if (dirty && !window.confirm('В заказе есть несохранённые изменения. Открыть другой заказ?')) return;
    const next = order ? { id: order.id, name: order.name, commission: order.commission, exchange: order.exchange, freightRate: order.freightRate, lines: order.lines } : freshOrder();
    setDraft(next); setSaved(JSON.stringify(next)); setRevision(order?.revision ?? 0); setView('order'); setError('');
  }
  return <div className="procurement-workspace">
    <div className="procurement-toolbar"><div><h2>Закуп и формирование склада</h2><p>Каталог → выбор товаров → заказ посреднику → сверка фактического наличия.</p></div><div className="materials-actions"><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void importFile(event)} /><button type="button" className="materials-btn" disabled={busy || !data.ready} onClick={() => fileInput.current?.click()}>Загрузить каталог</button><button type="button" className="materials-btn materials-primary" disabled={busy} onClick={() => setView('order')}>К заказу · {draft.lines.length}</button></div></div>
    <div className="procurement-local-tabs"><button type="button" aria-pressed={view === 'catalog'} onClick={() => setView('catalog')}>Каталог · {data.items.length}</button><button type="button" aria-pressed={view === 'order'} onClick={() => setView('order')}>Текущий заказ</button></div>
    {data.error && <p role="alert" className="materials-notice materials-error">{data.error}</p>}{error && <p role="alert" className="materials-notice materials-error">{error}</p>}{notice && <p role="status" className="materials-notice materials-success">{notice}</p>}
    {!data.ready && !data.error && <p role="status" className="materials-notice">Загружаем каталог и заказы…</p>}
    {view === 'catalog' && <section className="materials-panel"><header><div><h2>Товары из заказов</h2><p>Цены и количества — исторические. Перед новым закупом проверьте цену и модификацию.</p></div><span className="procurement-caption">{filtered.length} позиций</span></header><div className="materials-filters"><label>Поиск<input type="search" aria-label="Найти товар для закупа" value={search} placeholder="Название, модель, ссылка или заказ" onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><label>Показать<select aria-label="Фильтр каталога закупа" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">Все товары</option><option value="unlinked">Ещё не связаны со складом</option><option value="low">Заканчиваются на складе</option><option value="review">Нужно уточнить модификацию</option></select></label></div>
      <fieldset className="procurement-fieldset" disabled={busy || !data.ready}><div className="procurement-catalog">{visible.map(item => {
        const material = materials.find(value => value.id === item.linkedMaterialId);
        return <article className={`procurement-card ${selected.has(item.id) ? 'procurement-selected' : ''}`} key={item.id}><div className="procurement-card-top">{item.imageDataUrl ? <img loading="lazy" src={item.imageDataUrl} alt="Фото товара из заказа" /> : <span className="procurement-no-photo">Фото позже</span>}<label className="materials-check"><input type="checkbox" aria-label={`В заказ: ${item.name}`} checked={selected.has(item.id)} onChange={() => pick(item)} />В заказ</label></div><h3>{item.name}</h3>{item.variant !== item.name && <p className="procurement-variant">{item.variant}</p>}{item.needsReview && <span className="materials-tag warning">Уточнить модификацию</span>}<p className="procurement-caption">Последняя цена: {fen(item.suppliers[0]?.priceFen ?? null)} за единицу заказа</p><div className="procurement-suppliers">{item.suppliers.map(supplier => safeSupplierUrl(supplier.url) && <a key={supplier.url} href={safeSupplierUrl(supplier.url)!} target="_blank" rel="noopener noreferrer">{supplier.site} · {supplier.product} ↗</a>)}</div><details><summary>История закупок · {item.sources.length}</summary>{item.reviewNote && <p className="procurement-caption">{item.reviewNote}</p>}<ul>{item.sources.map((source, index) => <li key={source.file + source.row + '_' + index}>{source.file}, строка {source.row}<br />{source.description || 'Модификация не указана'} · {source.quantity || 'Количество не указано'} · {fen(source.priceFen)}</li>)}</ul></details><div className="procurement-card-footer">{material ? <div className="procurement-caption">На складе: {material.name}<br />{material.stockConfirmed === false ? 'Остаток ещё не указан' : `Остаток: ${(material.quantityMilli / 1000).toLocaleString('ru-RU')}`}</div> : <button type="button" className="materials-btn" disabled={!materialsReady} onClick={() => setLinking(item)}>Сформировать позицию склада</button>}</div></article>;
      })}</div></fieldset>
      {data.ready && !visible.length && <p className="materials-empty">{data.items.length ? 'Товаров по этому фильтру нет.' : 'Загрузите подготовленный файл каталога. История закупок сохранится отдельно от фактических остатков.'}</p>}<div className="procurement-pagination"><button type="button" className="materials-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Назад</button><span>{safePage} / {pageCount}</span><button type="button" className="materials-btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Далее</button></div>
    </section>}
    {view === 'order' && <><div className="procurement-order-picker"><label>Сохранённые заказы<select aria-label="Сохранённые заказы" disabled={busy} value="" onChange={event => { const order = data.orders.find(value => value.id === event.target.value); if (order) openOrder(order); }}><option value="">Выберите заказ</option>{[...data.orders].sort((a, b) => b.name.localeCompare(a.name, 'ru')).map(order => <option key={order.id} value={order.id}>{order.name} · {order.lines.length} позиций</option>)}</select></label><button type="button" className="materials-btn" disabled={busy} onClick={() => openOrder()}>Новый заказ</button></div><ProcurementOrderEditor draft={draft} catalog={data.items} onChange={setDraft} onSave={() => void save()} onExport={exportOrder} busy={busy || !data.ready} dirty={dirty} /></>}
    {linking && <StockLinkForm key={linking.id} item={linking} materials={materials} onClose={() => setLinking(null)} onSaved={() => { setLinking(null); setNotice('Позиция связана со складом. Для новой позиции внесите фактическое наличие через «Сверить остаток».'); }} />}
  </div>;
}
