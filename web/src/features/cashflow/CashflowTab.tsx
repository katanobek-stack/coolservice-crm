import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../auth';
import { useData } from '../../shared/context/DataContext';
import { buildCashflow, cashflowAccess, cashflowCategory, cashflowExportRows, cashflowMoney, cashflowSources, cashflowToday, type CashflowEntry, type CashflowKind, type CashflowSource } from './cashflowLogic';
import { useCashflow } from './useCashflow';
import { CashflowForecast, CashflowJournal, CashflowOverview, CashflowSummary, cashflowDateLabel } from './CashflowWorkspace';
import { CashflowAccountForm, CashflowActionForm, CashflowEntryForm, cashflowError } from './CashflowForms';
import './cashflow.css';

type View = 'overview' | 'journal' | 'plan' | 'sources' | 'accounts';
type EntryDraft = { kind: CashflowKind; source?: CashflowSource; status?: 'actual' | 'planned' };
export function CashflowTab() {
  const { myProfile, isOwner } = useAuth();
  if (!cashflowAccess(isOwner ? 'owner' : myProfile?.role, myProfile?.permissions?.pl_panel)) return <p role="status">ДДС доступен сотрудникам с разрешением на финансовую панель.</p>;
  return <CashflowContent />;
}
function CashflowContent() {
  const { user } = useAuth(), crm = useData(), cash = useCashflow();
  const [month, setMonth] = useState(cashflowToday().slice(0, 7)), [accountId, setAccountId] = useState(''), [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState(''), [status, setStatus] = useState('actual'), [kind, setKind] = useState('all');
  const [draft, setDraft] = useState<EntryDraft | null>(null), [accountForm, setAccountForm] = useState(false), [action, setAction] = useState<{ entry: CashflowEntry; type: 'post' | 'void' } | null>(null);
  const [notice, setNotice] = useState(''), [exportError, setExportError] = useState(''), [exporting, setExporting] = useState(false), [sourceSearch, setSourceSearch] = useState('');
  const today = cashflowToday();
  const report = useMemo(() => cash.ready ? buildCashflow(cash.accounts, cash.entries, month, accountId, today) : null, [cash.ready, cash.accounts, cash.entries, month, accountId, today]);
  const sourceReady = ['clients', 'freezers', 'finance'].every(key => crm.sourceStatus[key as 'clients' | 'freezers' | 'finance'] === 'ready');
  const sources = useMemo(() => sourceReady && cash.ready ? cashflowSources(crm, cash.entries, month, today) : [], [sourceReady, cash.ready, crm.clients, crm.freezers, crm.finance, cash.entries, month, today]);
  const journal = (report?.periodEntries ?? []).filter(e => (status === 'all' || e.status === status) && (kind === 'all' || e.kind === kind) && `${e.counterparty} ${e.comment} ${cashflowCategory(e.category)?.label ?? ''}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  const plans = cash.entries.filter(e => e.status === 'planned' && (!accountId || e.accountId === accountId || e.targetAccountId === accountId)).sort((a, b) => a.date.localeCompare(b.date));
  const candidates = sources.filter(s => `${s.title} ${s.comment}`.toLocaleLowerCase('ru-RU').includes(sourceSearch.trim().toLocaleLowerCase('ru-RU')));
  function saved() { setDraft(null); setAccountForm(false); setAction(null); setNotice('Сохранено. Итоги обновятся после подтверждения записи.'); }
  function add(kind: CashflowKind, status: 'actual' | 'planned' = 'actual') { setNotice(''); setDraft({ kind, status }); }
  async function exportMonth() {
    if (!report || !cash.accounts.length || exporting) return;
    setExporting(true); setExportError('');
    try {
      const rows = cashflowExportRows(report), book = XLSX.utils.book_new();
      for (const [name, values] of [['ДДС', rows.summary], ['Операции', rows.operations], ['Статьи', rows.categories], ['Счета', rows.accounts], ['План 13 недель', rows.forecast], ['План месяца', rows.budget]] as const) {
        const sheet = XLSX.utils.aoa_to_sheet(values); sheet['!cols'] = values[0].map((_, i) => ({ wch: i === 0 ? 38 : 24 }));
        for (const key of Object.keys(sheet)) if (!key.startsWith('!') && sheet[key].t === 'n') sheet[key].z = '#,##0.00';
        sheet['!autofilter'] = { ref: sheet['!ref'] ?? 'A1' }; XLSX.utils.book_append_sheet(book, sheet, name);
      }
      XLSX.writeFile(book, `РефСервисДВ_ДДС_${report.month}${accountId ? '_счёт' : ''}.xlsx`);
    } catch (err) { setExportError(cashflowError(err)); } finally { setExporting(false); }
  }
  return <div className="dds-workspace">
    <header className="dds-hero"><div><span className="dds-eyebrow">Финансы РефСервисДВ</span><h1>Движение денежных средств</h1><p>Что поступило, что выплачено и сколько денег остаётся.</p></div><span className="dds-hero-mark" aria-hidden="true">₽</span></header>
    <div className="dds-toolbar"><div className="dds-period"><label>Месяц отчёта<input type="month" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} /></label><label>Счета<select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Все счета и касса</option>{cash.accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label></div><button type="button" className="dds-btn" disabled={!report || !cash.accounts.length || exporting} onClick={() => void exportMonth()}><i className="ti ti-file-spreadsheet" aria-hidden="true" />{exporting ? 'Готовим отчёт…' : 'Скачать Excel'}</button></div>
    <CashflowSummary report={cash.accounts.length ? report : null} />
    <p className="dds-help">ДДС показывает движение денег, а не прибыль. Все платежи учитываются целиком, включая НДС. Закрытая заявка и начисленная зарплата сами по себе не меняют остатки.</p>
    {!cash.ready && <div className={`dds-notice ${cash.error ? 'dds-error' : ''}`} role={cash.error ? 'alert' : 'status'}>{cash.error || 'Получаем счета и денежные операции. До подтверждения данных итоги и сохранение недоступны.'}{cash.error && <button className="dds-btn" type="button" onClick={cash.retry}>Повторить загрузку</button>}</div>}
    {notice && <div className="dds-notice dds-success" role="status">{notice}</div>}{exportError && <div className="dds-notice dds-error" role="alert">{exportError}</div>}
    <nav className="dds-tabs" aria-label="Разделы ДДС">{([['overview', 'Обзор'], ['journal', 'Операции'], ['plan', 'План платежей'], ['sources', 'Из CRM'], ['accounts', 'Счета и касса']] as const).map(([key, label]) => <button type="button" key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)} className={view === key ? 'active' : ''}>{label}</button>)}</nav>
    <div className="dds-actions"><button type="button" className="dds-btn dds-primary" disabled={!cash.ready || !cash.accounts.length} onClick={() => add('income')}>+ Поступление</button><button type="button" className="dds-btn" disabled={!cash.ready || !cash.accounts.length} onClick={() => add('expense')}>− Выплата</button><button type="button" className="dds-btn" disabled={!cash.ready || cash.accounts.length < 2} onClick={() => add('transfer')}>Перевод между счетами</button></div>
    {cash.ready && !cash.accounts.length && <section className="dds-onboarding"><div className="dds-onboarding-icon" aria-hidden="true"><i className="ti ti-building-bank" /></div><h2>Начнём с ваших счетов</h2><p>Добавьте расчётный счёт или кассу и остаток на начало выбранного дня. После этого можно записывать оплаты и планировать платежи.</p><button type="button" className="dds-btn dds-primary" onClick={() => setAccountForm(true)}>Добавить первый счёт</button></section>}
    {cash.ready && cash.accounts.length > 0 && report && <>
      {view === 'overview' && <CashflowOverview report={report} />}
      {view === 'journal' && <section className="dds-panel"><header><div><h2>Журнал операций</h2><p>За {month}. Показано {journal.length} из {report.periodEntries.length}. Excel сохраняет полный отчёт по месяцу и выбранным счетам, без поискового фильтра.</p></div></header><div className="dds-filters"><label>Поиск<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Контрагент, статья, назначение" /></label><label>Статус<select value={status} onChange={e => setStatus(e.target.value)}><option value="actual">Факт</option><option value="planned">План</option><option value="void">Аннулировано</option><option value="all">Все статусы</option></select></label><label>Операция<select value={kind} onChange={e => setKind(e.target.value)}><option value="all">Все операции</option><option value="income">Поступления</option><option value="expense">Выплаты</option><option value="transfer">Переводы</option></select></label></div><CashflowJournal entries={journal} accounts={cash.accounts} onPost={entry => setAction({ entry, type: 'post' })} onVoid={entry => setAction({ entry, type: 'void' })} /></section>}
      {view === 'plan' && <><CashflowForecast report={report} /><section className="dds-panel"><header><div><h2>Ожидаемые платежи</h2><p>Все даты по выбранным счетам, включая просрочку. После оплаты проведите существующий план — вторая запись не нужна.</p></div><button className="dds-btn" type="button" onClick={() => add('expense', 'planned')}>Добавить платёж</button></header><CashflowJournal entries={plans} accounts={cash.accounts} onPost={entry => setAction({ entry, type: 'post' })} onVoid={entry => setAction({ entry, type: 'void' })} /></section></>}
      {view === 'sources' && <section className="dds-panel"><header><div><h2>Оформить оплату из CRM</h2><p>Закрытые заявки за {month}, зарплата, аренда и абонплата. Предложения не являются оплатами. Суммы регулярных платежей взяты из текущих настроек — проверьте период и договор.</p></div></header>{!sourceReady ? <div className="dds-notice" role="status">Источники CRM загружаются или недоступны. Ручной учёт ДДС продолжает работать.</div> : <><div className="dds-filters"><label>Найти источник<input type="search" value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder="Клиент, работы или сотрудник" /></label></div>{!candidates.length && <p className="dds-empty">Нет предложений за выбранный период. Оплату можно внести вручную.</p>}<div className="dds-sources">{candidates.map(source => <article className="dds-source" key={source.key}><div><span className="dds-tag">{cashflowCategory(source.category)?.label}</span><h3>{source.title}</h3><p>{source.comment}</p><small>Сумма: {cashflowMoney(source.amountCents)} · Учтено: {cashflowMoney(source.paidCents)} · В плане: {cashflowMoney(source.reservedCents)}</small></div><div className="dds-source-action"><strong>{cashflowMoney(source.remainingCents)}</strong><span>{source.remainingCents > 0 ? 'Осталось оформить' : 'Уже учтено или запланировано'}</span><button type="button" className="dds-btn" disabled={source.remainingCents <= 0} onClick={() => setDraft({ kind: source.kind, source })}>Оформить оплату</button></div></article>)}</div></>}</section>}
      {view === 'accounts' && <section className="dds-panel"><header><div><h2>Счета и касса</h2><p>Остатки на сегодня, {cashflowDateLabel(today)}, по всем внесённым фактическим операциям. Начальные остатки после сохранения фиксируются.</p></div><button className="dds-btn dds-primary" type="button" onClick={() => setAccountForm(true)}>Добавить счёт</button></header><div className="dds-account-grid">{buildCashflow(cash.accounts, cash.entries, month, '', today).accountBalances.map(a => <article key={a.id}><span>{a.name}</span><strong className={a.balanceCents !== null && a.balanceCents < 0 ? 'dds-text-expense' : ''}>{a.balanceCents === null ? 'Учёт ещё не начат' : cashflowMoney(a.balanceCents)}</strong><p>Начало учёта: {cashflowDateLabel(a.openedOn)}</p><small>Начальный остаток: {cashflowMoney(a.openingCents)}</small></article>)}</div></section>}
    </>}
    {draft && <CashflowEntryForm accounts={cash.accounts} uid={user?.uid ?? ''} source={draft.source} initialKind={draft.kind} initialStatus={draft.status} ready={cash.ready} onClose={() => setDraft(null)} onSaved={saved} />}
    {accountForm && <CashflowAccountForm uid={user?.uid ?? ''} ready={cash.ready} onClose={() => setAccountForm(false)} onSaved={saved} />}
    {action && <CashflowActionForm entry={action.entry} action={action.type} uid={user?.uid ?? ''} ready={cash.ready} onClose={() => setAction(null)} onSaved={saved} />}
  </div>;
}
