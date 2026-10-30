import * as XLSX from 'xlsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../shared/context/DataContext';
import { useAuth } from '../auth';
import { genId, fmtDate } from '../../shared/utils/format';
import { shiftMonth } from '../../shared/utils/finance';
import { removeDocumentIfUnchanged } from '../../shared/firebase/concurrency';
import { savePnlElectricity, addPnlPurchase, addPnlCommission, removePnlPurchase, type PnlCommissionInput } from '../../shared/firebase/pnl';
import { buildPnlMonth, pnlMonths, preparePnlAttempt, pnlEntryPeriodOnOpen, type PnlAttempt, pnlMonthLabel, pnlMoney, localPnlDate, parsePnlAmount, selectPnlJournal, pnlExportRows, pnlAccess, validPnlMonth, type PnlData, type PnlFinance, type PnlOperation, type PnlPurchase, type PnlKind } from './pnlLogic';
import { PnlSourceBoundary, PnlSummary, PnlPanel, PnlFeedback, pnlError } from './PnlWorkspace';
import { PnlSettings } from './PnlSettings';
import './pnl.css';
type View = 'overview' | 'journal' | 'income' | 'settings';
export function PnlTab() { const { myProfile, isOwner } = useAuth(); return pnlAccess(isOwner ? 'owner' : myProfile?.role, myProfile?.permissions?.pl_panel) ? <PnlContent /> : <div className="pnl-notice" role="status">Раздел P&L доступен сотрудникам с разрешением на финансовую панель.</div>; }
function PnlContent() {
    const source = useData(), { user, myProfile } = useAuth();
    const current = localPnlDate().slice(0, 7), [month, setMonth] = useState(current), [view, setView] = useState<View>('overview');
    const [kind, setKind] = useState<'all' | PnlKind>('all'), [search, setSearch] = useState(''), [sort, setSort] = useState<'newest' | 'oldest' | 'amount'>('newest');
    const [purchaseInitial, setPurchaseInitial] = useState<string | null>(null), [commissionInitial, setCommissionInitial] = useState<string | null>(null);
    const [purchaseOpen, setPurchaseOpen] = useState(false), [commissionOpen, setCommissionOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
    const [bill, setBill] = useState<{
        month: string;
        expected: unknown;
        value: string;
    } | null>(null), [billError, setBillError] = useState(''), [billBusy, setBillBusy] = useState(false);
    const [removal, setRemoval] = useState<PnlOperation | null>(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState('');
    const [notice, setNotice] = useState(''), [exportError, setExportError] = useState(''), [exporting, setExporting] = useState(false);
    const billLock = useRef(false), deleteLock = useRef(false), removalRef = useRef<HTMLElement>(null);
    useEffect(() => { if (removal)
        removalRef.current?.focus(); }, [removal]);
    const required = ['clients', 'freezers', 'finance', 'expenses'] as const;
    const ready = required.every(k => source.sourceStatus[k] === 'ready'), error = required.some(k => source.sourceStatus[k] === 'error');
    const data: PnlData = { clients: source.clients, freezers: source.freezers, finance: source.finance as PnlFinance, expenses: source.expenses };
    // Retain settings and month lists during listener failures without displaying stale totals.
    const last = useRef<PnlData | null>(null);
    if (ready)
        last.current = data;
    const confirmed = ready ? data : last.current;
    const report = useMemo(() => confirmed ? buildPnlMonth(confirmed, month) : null, [confirmed, month]);
    const history = useMemo(() => confirmed ? Array.from({ length: 12 }, (_, i) => buildPnlMonth(confirmed, shiftMonth(month, -i))) : [], [confirmed, month]);
    const months = confirmed ? pnlMonths(confirmed, current) : [current];
    if (!months.includes(month))
        months.push(month);
    months.sort().reverse();
    const journal = selectPnlJournal(report?.journal ?? [], { kind, search, sort });
    const liveRental = confirmed ? buildPnlMonth({ ...confirmed, finance: { ...confirmed.finance, fixedCostHistory: {} } }, current).rentalIncome : 0;
    function changeMonth(value: string) { if (validPnlMonth(value)) {
        setMonth(value);
        setNotice('');
    } }
    function openEntry(entry: PnlKind) { setView('journal'); if (entry === 'purchase') {
        setPurchaseInitial(v => v ?? month);
        setPurchaseOpen(true);
    }
    else {
        setCommissionInitial(v => v ?? month);
        setCommissionOpen(true);
    } }
    async function saveBill() { if (!ready || !bill || billLock.current)
        return; const amount = parsePnlAmount(bill.value); if (amount === null) {
        setBillError('Введите сумму от 0 с точностью до копеек. Например: 1 250,50.');
        return;
    } billLock.current = true; setBillBusy(true); setBillError(''); try {
        await savePnlElectricity(bill.month, amount, bill.expected);
        setNotice(`Счёт за ${pnlMonthLabel(bill.month)} сохранён: ${pnlMoney(amount)}.`);
        setBill(null);
    }
    catch (e) {
        setBillError(pnlError(e));
    }
    finally {
        billLock.current = false;
        setBillBusy(false);
    } }
    async function remove() { if (!ready || !removal || deleteLock.current)
        return; deleteLock.current = true; setDeleteBusy(true); setDeleteError(''); try {
        if (removal.kind === 'purchase' && removal.purchase)
            await removePnlPurchase(removal.purchase);
        else if (removal.expense)
            await removeDocumentIfUnchanged('expenses', removal.expense);
        setNotice('Операция удалена из учёта.');
        setRemoval(null);
    }
    catch (e) {
        setDeleteError(pnlError(e));
    }
    finally {
        deleteLock.current = false;
        setDeleteBusy(false);
    } }
    async function exportMonth() { if (!ready || !report || exporting)
        return; setExporting(true); setExportError(''); try {
        const rows = pnlExportRows(report), book = XLSX.utils.book_new();
        for (const [name, values] of [['P&L', rows.summary], ['Операции', rows.operations], ['Ремонты', rows.repairs]] as const) {
            const sheet = XLSX.utils.aoa_to_sheet(values);
            sheet['!cols'] = [{ wch: 35 }, { wch: 30 }, { wch: 40 }, { wch: 42 }, { wch: 18 }];
            XLSX.utils.book_append_sheet(book, sheet, name);
        }
        XLSX.writeFile(book, `РефСервисДВ_PnL_${report.month}.xlsx`);
    }
    catch (e) {
        setExportError(pnlError(e));
    }
    finally {
        setExporting(false);
    } }
    return <div className="pnl-workspace">
  <header className="pnl-hero"><div><h1>P&L: доходы и расходы</h1><p>От выручки до результата — все статьи выбранного месяца в одном месте.</p></div><span>Финансы РефСервисДВ</span></header>
  <div className="pnl-toolbar"><div className="pnl-period"><button className="pnl-btn" type="button" aria-label="Предыдущий месяц" onClick={() => changeMonth(shiftMonth(month, -1))}>←</button><label>Период отчёта<select value={month} onChange={e => changeMonth(e.target.value)}>{months.map(m => <option value={m} key={m}>{pnlMonthLabel(m)}</option>)}</select></label><button className="pnl-btn" type="button" aria-label="Следующий месяц" onClick={() => changeMonth(shiftMonth(month, 1))} disabled={month >= current}>→</button>{month !== current && <button className="pnl-btn" onClick={() => changeMonth(current)}>Текущий месяц</button>}</div><button className="pnl-btn" disabled={!ready || exporting} onClick={() => void exportMonth()}>{exporting ? 'Готовим файл…' : 'Скачать Excel за месяц'}</button></div>
  <PnlSummary report={ready ? report : null} onIncome={() => setView('income')} onExpenses={() => setView('journal')}/>
  <p className="pnl-accounting-note">Доходы от ремонтов учитываются по выполненным заявкам, в том числе до подтверждения менеджером. Месяц — по дате закрытия, а для старых записей — по дате заявки. Это не подтверждение оплаты. Аренда и постоянные расходы учитываются помесячно.</p>
  <PnlFeedback success={notice} error={exportError}/>
  <PnlSourceBoundary ready={ready} error={error}>
   <nav className="pnl-tabs" aria-label="Разделы P&L">{([['overview', 'Обзор'], ['journal', 'Расходы и операции'], ['income', 'Доходы по заявкам'], ['settings', 'Постоянные расходы']] as const).map(([id, label]) => <button type="button" key={id} aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</nav>
   {report && <div className="pnl-period-caption">{pnlMonthLabel(month)}{month > current ? ' · будущий период' : ''}<span>Все итоги и Excel относятся к этому месяцу</span></div>}
   {ready && report && month !== current && report.liveFixedFields.length > 0 && <div className="pnl-notice">Для этого периода не сохранены отдельные исторические суммы: {report.liveFixedFields.map(k => ({ boxCost: 'аренда боксов', salCost: 'зарплаты и услуги', rentalIncome: 'аренда камер' }[k])).join(', ')}. Для них используются текущие настройки. Остальные сохранённые суммы периода учтены.</div>}
   <div hidden={view !== 'overview' || !ready}>
    {report && <PnlPanel title="Как получился результат" description="Полная расшифровка выбранного месяца"><div className="pnl-calculation"><div className="pnl-calc-income"><h3>Доходы</h3><dl><dt>Выполненные ремонты</dt><dd>{pnlMoney(report.repairRevenue)}</dd><dt>Аренда камер</dt><dd>{pnlMoney(report.rentalIncome)}</dd></dl><strong>Итого {pnlMoney(report.income)}</strong></div><div className="pnl-calc-expense"><h3>Расходы</h3><dl>{[['Аренда боксов', report.boxCost], ['Зарплаты и услуги', report.salCost], ['Электричество', report.electricity], ['Закупки и материалы', report.purchases], ['Комиссионные', report.commissions]].map(([label, amount]) => <div className="pnl-dl-row" key={label}><dt>{label}</dt><dd>{pnlMoney(amount as number)}</dd></div>)}</dl><strong>Итого {pnlMoney(report.totalExpenses)}</strong></div></div><footer className={`pnl-equation ${report.profit < 0 ? 'pnl-loss' : ''}`}><span>Доходы − расходы = {report.profit < 0 ? 'убыток' : 'прибыль'}</span><strong>{pnlMoney(report.profit)}</strong></footer></PnlPanel>}
    <div className="pnl-quick-actions"><button className="pnl-btn pnl-primary" onClick={() => openEntry('purchase')}>Добавить закупку</button><button className="pnl-btn" onClick={() => openEntry('commission')}>Добавить комиссионные</button><button className="pnl-btn" onClick={() => { setView('journal'); if (billLock.current) return; setBillError(''); setBill({ month, expected: confirmed?.finance.elecBills?.[month], value: String(confirmed?.finance.elecBills?.[month] ?? '') }); }}>Внести счёт за электричество</button></div>
    <PnlPanel title="Динамика по месяцам" description="12 месяцев до выбранного периода включительно. Нажмите на месяц для расшифровки."><div className="pnl-table-scroll"><table className="pnl-table"><thead><tr><th>Месяц</th><th className="pnl-numeric">Доходы</th><th className="pnl-numeric">Расходы</th><th className="pnl-numeric">Результат</th></tr></thead><tbody>{history.map(m => <tr className={m.month === month ? 'selected' : ''} key={m.month}><th><button className="pnl-link" onClick={() => changeMonth(m.month)}>{pnlMonthLabel(m.month)}</button>{m.month !== current && m.liveFixedFields.length > 0 && <small>Есть суммы из текущих настроек</small>}</th><td className="pnl-numeric pnl-text-income">{pnlMoney(m.income)}</td><td className="pnl-numeric">{pnlMoney(m.totalExpenses)}</td><td className={`pnl-numeric ${m.profit < 0 ? 'pnl-text-expense' : 'pnl-text-income'}`}>{pnlMoney(m.profit)}</td></tr>)}</tbody></table></div></PnlPanel>
   </div>
   <div hidden={view !== 'journal'}>
    <PnlPanel title="Расходы и операции" description="Закупки и комиссионные выбранного месяца. Электричество и постоянные расходы входят в общие итоги отдельно." action={<div className="pnl-form-actions"><button className="pnl-btn pnl-primary" onClick={() => { setPurchaseInitial(v => v ?? month); setPurchaseOpen(v => !v); }}>Добавить закупку</button><button className="pnl-btn" onClick={() => { setCommissionInitial(v => v ?? month); setCommissionOpen(v => !v); }}>Добавить комиссионные</button></div>}>
     <div hidden={!purchaseOpen}>{purchaseInitial && <PnlEntryForm kind="purchase" initialMonth={month} open={purchaseOpen} blocked={!ready} author={myProfile?.name ?? ''} uid={user?.uid ?? ''} onClose={() => setPurchaseOpen(false)} onSuccess={setNotice}/>}</div>
     <div hidden={!commissionOpen}>{commissionInitial && <PnlEntryForm kind="commission" initialMonth={month} open={commissionOpen} blocked={!ready} author={myProfile?.name ?? ''} uid={user?.uid ?? ''} onClose={() => setCommissionOpen(false)} onSuccess={setNotice}/>}</div>
     <div className="pnl-journal-filters"><label>Поиск операций<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Описание, сотрудник, дата…"/></label><label>Статья<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="all">Все операции</option><option value="purchase">Закупки и материалы</option><option value="commission">Комиссионные</option></select></label><label>Порядок<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="newest">Сначала новые</option><option value="oldest">Сначала давние</option><option value="amount">Сначала крупные</option></select></label></div>
     <div hidden={!ready}><div className="pnl-list-caption">Найдено: {journal.length} из {report?.journal.length ?? 0}<span>Фильтры не меняют общие итоги и Excel</span></div>{journal.length === 0 ? <div className="pnl-empty">{search || kind !== 'all' ? 'Операций по этим условиям нет. Измените поиск или статью.' : 'В этом месяце ещё нет закупок и комиссионных. Добавьте первую операцию выше.'}</div> : <div className="pnl-journal">{journal.map(r => <article key={`${r.kind}/${r.id}`} className={`pnl-operation pnl-operation-${r.kind}`}><div><span className="pnl-tag">{r.kind === 'purchase' ? 'Закупка' : 'Комиссионные'}</span><h3>{r.comment}</h3><p>{r.kind === 'purchase' ? fmtDate(r.date) : pnlMonthLabel(r.date)}{r.author ? ` · ${r.author}` : ''}</p></div><strong>{pnlMoney(r.amount)}</strong><button className="pnl-btn pnl-danger" disabled={deleteBusy} onClick={() => { setRemoval(r); setDeleteError(''); }} aria-label={`Удалить ${r.kind === 'purchase' ? 'закупку' : 'комиссионные'}: ${r.comment}`}>Удалить</button></article>)}</div>}</div>
    </PnlPanel>
    <PnlPanel title="Электричество" description={`Счёт за ${pnlMonthLabel(month)} в рублях, не показания счётчика.`}><div className="pnl-bill-heading"><strong>{ready && report ? pnlMoney(report.electricity) : '—'}</strong><button className="pnl-btn" disabled={billBusy} onClick={() => { if (billLock.current) return; setBillError(''); setBill({ month, expected: confirmed?.finance.elecBills?.[month], value: String(confirmed?.finance.elecBills?.[month] ?? '') }); }}>Изменить счёт за месяц</button></div>{bill && <form className="pnl-entry-form" onSubmit={e => { e.preventDefault(); void saveBill(); }}><h3>Счёт за {pnlMonthLabel(bill.month)}</h3><p>Новая сумма заменит счёт только за указанный месяц. Нулевой счёт допустим.</p><label>Сумма счёта, ₽<input inputMode="decimal" value={bill.value} onChange={e => setBill({ ...bill, value: e.target.value })} disabled={billBusy}/></label><PnlFeedback error={billError}/><div className="pnl-form-actions"><button className="pnl-btn pnl-primary" disabled={billBusy}>{billBusy ? 'Сохраняем…' : 'Сохранить счёт'}</button><button className="pnl-btn" type="button" disabled={billBusy} onClick={() => setBill(null)}>Отмена</button>{billError && <button className="pnl-btn" type="button" disabled={billBusy} onClick={() => { setBill({ ...bill, expected: confirmed?.finance.elecBills?.[bill.month] }); setBillError(''); }}>Повторно сверить: сейчас {pnlMoney(Number(confirmed?.finance.elecBills?.[bill.month] ?? 0))}</button>}</div></form>}</PnlPanel>
   </div>
   <div hidden={view !== 'income' || !ready}><PnlPanel title="Доходы по выполненным заявкам" description="Ремонты, вошедшие в доходы выбранного месяца. Аренда камер включена отдельной строкой в обзоре.">{report?.repairs.length ? <div className="pnl-journal">{[...report.repairs].sort((a, b) => b.date.localeCompare(a.date)).map(r => <article className="pnl-operation pnl-operation-income" key={r.key}><div><span className="pnl-tag">{fmtDate(r.date)}</span><h3>{r.client}</h3><p>{r.object}</p><p>{r.description}</p></div><strong>{pnlMoney(r.amount)}</strong></article>)}</div> : <div className="pnl-empty">Выполненных заявок за этот месяц нет.</div>}</PnlPanel></div>
   <div hidden={view !== 'settings'}><PnlPanel title="Постоянные расходы" description="Настройки текущего месяца. Для просмотра исторического результата используйте «Обзор»." action={!settingsOpen ? <button className="pnl-btn" onClick={() => setSettingsOpen(true)}>Изменить настройки</button> : undefined}>{settingsOpen && confirmed ? <PnlSettings finance={confirmed.finance} rentalIncome={liveRental} blocked={!ready} onClose={() => setSettingsOpen(false)}/> : <div hidden={!ready} className="pnl-fixed-list">{(confirmed?.finance.boxes ?? []).map((b, i) => <div key={b.id || i}><span>Аренда · {b.name || 'Бокс'}</span><strong>{pnlMoney(b.cost)}/мес.</strong></div>)}{(confirmed?.finance.salaries ?? []).map((s, i) => <div key={s.uid || i}><span>Зарплата / услуга · {s.name || 'Без названия'}</span><strong>{pnlMoney(s.salary)}/мес.</strong></div>)}{!confirmed?.finance.boxes?.length && !confirmed?.finance.salaries?.length && <p className="pnl-empty">Постоянные расходы пока не настроены.</p>}<p className="pnl-accounting-note">Тариф электричества: {pnlMoney(confirmed?.finance.kwPrice ?? 0)} / кВт·ч. Счета вносятся отдельно.</p></div>}</PnlPanel></div>
   {removal && <section ref={removalRef} tabIndex={-1} className="pnl-delete-review" aria-label="Подтверждение удаления операции"><h2>Удалить операцию из учёта?</h2><p><b>{removal.comment}</b> · {removal.date} · {pnlMoney(removal.amount)}</p><p>Сумма перестанет учитываться в P&L. Восстановление возможно повторным вводом операции.</p><PnlFeedback error={deleteError}/><div className="pnl-form-actions"><button className="pnl-btn pnl-danger" onClick={() => void remove()} disabled={deleteBusy}>{deleteBusy ? 'Удаляем…' : 'Подтвердить удаление'}</button><button className="pnl-btn" onClick={() => setRemoval(null)} disabled={deleteBusy}>Оставить операцию</button></div></section>}
  </PnlSourceBoundary>
 </div>;
}
function PnlEntryForm({ kind, initialMonth, open, blocked, uid, author, onClose, onSuccess }: {
    kind: PnlKind;
    initialMonth: string;
    open: boolean;
    blocked: boolean;
    uid: string;
    author: string;
    onClose: () => void;
    onSuccess: (value: string) => void;
}) {
    const [amount, setAmount] = useState(''), [comment, setComment] = useState(''), [date, setDate] = useState(() => initialMonth === localPnlDate().slice(0, 7) ? localPnlDate() : `${initialMonth}-01`), [month, setMonth] = useState(initialMonth);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [dirty,setDirty]=useState(false);
    const lock=useRef(false),retry=useRef<PnlAttempt|null>(null);
    useEffect(()=>{if(!open||busy)return;const next=pnlEntryPeriodOnOpen({date,month},dirty,initialMonth,localPnlDate());setDate(next.date);setMonth(next.month);},[open,initialMonth,dirty,busy]);
    async function save() {
        if (blocked || lock.current)
            return;
        setError('');
        const value = parsePnlAmount(amount, true), period = kind === 'purchase' ? date.slice(0, 7) : month;
        if (value === null || !validPnlMonth(period) || (kind === 'purchase' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !comment.trim()))) {
            setError('Укажите корректный период, сумму больше 0 с точностью до копеек и описание закупки.');
            return;
        }
        retry.current=preparePnlAttempt(retry.current,genId(),new Date().toISOString());
    const {id,addedAt}=retry.current;
    lock.current = true;
        setBusy(true);
        try {
            if (kind === 'purchase')
                await addPnlPurchase({id,date,addedAt,amount:value,comment:comment.trim(),addedByName:author});
            else
                await addPnlCommission({id,category:'commission',month,amount:value,comment:comment.trim(),createdBy:uid});
            setAmount('');
            setComment('');
            retry.current = null;
        setDirty(false);
            onSuccess(`${kind === 'purchase' ? 'Закупка' : 'Комиссионные'} сохранены за ${pnlMonthLabel(period)}: ${pnlMoney(value)}. Если выбран другой месяц отчёта, переключите период для просмотра.`);
            onClose();
        }
        catch (e) {
            setError(`${pnlError(e)} Введённые данные сохранены. Повторное сохранение использует тот же номер операции, чтобы не создавать дубль. Если операция уже есть с другими значениями, сверьте журнал.`);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return <form className="pnl-entry-form" onSubmit={e => { e.preventDefault(); void save(); }}><h3>{kind === 'purchase' ? 'Новая закупка' : 'Новые комиссионные'}</h3><fieldset disabled={busy || blocked}><div className="pnl-entry-fields"><label>{kind === 'purchase' ? 'Дата закупки' : 'Месяц начисления'}{kind === 'purchase' ? <input type="date" value={date} onChange={e => {setDirty(true);setDate(e.target.value);}}/> : <input type="month" value={month} onChange={e => {setDirty(true);setMonth(e.target.value);}}/>}</label><label>Сумма, ₽<input inputMode="decimal" value={amount} onChange={e => {setDirty(true);setAmount(e.target.value);}} placeholder="Например: 1 250,50"/></label><label className="pnl-entry-comment">{kind === 'purchase' ? 'Что закупили' : 'Комментарий (необязательно)'}<input value={comment} onChange={e => {setDirty(true);setComment(e.target.value);}} placeholder={kind === 'purchase' ? 'Материалы, запчасти, оборудование…' : 'Кому и за что начислено…'}/></label></div><PnlFeedback error={error}/><div className="pnl-form-actions"><button className="pnl-btn pnl-primary">{busy ? 'Сохраняем…' : kind === 'purchase' ? 'Сохранить закупку' : 'Сохранить комиссионные'}</button><button type="button" className="pnl-btn" onClick={onClose}>Скрыть форму</button></div></fieldset></form>;
}
