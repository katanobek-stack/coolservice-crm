import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { CASHFLOW_CATEGORIES, cashflowMoney, cashflowToday, parseCashflowMoney, validateCashflowEntry, type CashflowAccount, type CashflowEntry, type CashflowKind, type CashflowSource } from './cashflowLogic';
import { createCashflowAccount, createCashflowEntry, postCashflowPlan, voidCashflowEntry } from '../../shared/firebase/cashflow';

export const cashflowError = (e: unknown) => e instanceof Error ? e.message : 'Не удалось сохранить. Проверьте соединение и журнал перед повтором.';
function Dialog({ title, children, busy, close }: { title: string; children: ReactNode; busy: boolean; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null; ref.current?.focus();
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; before?.focus(); };
  }, []);
  return <div className="dds-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) close(); }}><div className="dds-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={e => {
    if (e.key === 'Escape' && !busy) close();
    if (e.key === 'Tab') {
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? []), first = elements[0], last = elements.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}><header><h2>{title}</h2><button type="button" className="dds-close" aria-label="Закрыть" disabled={busy} onClick={close}>×</button></header>{children}</div></div>;
}
export function CashflowEntryForm({ accounts, uid, source, initialKind, initialStatus = 'actual', ready, onClose, onSaved }: {
  accounts: readonly CashflowAccount[]; uid: string; source?: CashflowSource; initialKind: CashflowKind; initialStatus?: 'actual' | 'planned'; ready: boolean; onClose: () => void; onSaved: () => void;
}) {
  const id = useRef(crypto.randomUUID()), lock = useRef(false);
  const [kind, setKind] = useState<CashflowKind>(source?.kind ?? initialKind), [status, setStatus] = useState<'actual' | 'planned'>(initialStatus);
  const [date, setDate] = useState(cashflowToday()), [account, setAccount] = useState(accounts[0]?.id ?? ''), [target, setTarget] = useState('');
  const [category, setCategory] = useState(source?.category ?? CASHFLOW_CATEGORIES.find(c => c.kind === initialKind)!.id);
  const [amount, setAmount] = useState(source ? String(source.remainingCents / 100) : ''), [counterparty, setCounterparty] = useState(source?.counterparty ?? ''), [comment, setComment] = useState(source?.comment ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!ready || lock.current) return;
    const amountCents = parseCashflowMoney(amount);
    const entry: CashflowEntry = { id: id.current, kind, status, date, accountId: account, targetAccountId: kind === 'transfer' ? target : '', category, amountCents: amountCents ?? 0, counterparty: counterparty.trim(), comment: comment.trim(), sourceKey: source?.key ?? '', sourceType: source?.type ?? 'manual', createdBy: uid };
    try { validateCashflowEntry(entry, accounts); } catch (err) { setError(cashflowError(err)); return; }
    lock.current = true; setBusy(true); setError('');
    try { await createCashflowEntry(entry); onSaved(); }
    catch (err) { setError(`${cashflowError(err)} Повторное сохранение использует тот же номер операции.`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={source ? 'Оплата по данным CRM' : 'Новая денежная операция'} busy={busy} close={onClose}><form onSubmit={e => void submit(e)}><fieldset disabled={busy || !ready}>
    {source && <div className="dds-notice"><b>{source.title}</b><p>Сумма источника: {cashflowMoney(source.amountCents)}. Учтено: {cashflowMoney(source.paidCents)}. В плане: {cashflowMoney(source.reservedCents)}.</p><p>Укажите фактическую оплату или сохраните ожидаемый платёж в план.</p></div>}
    <div className="dds-form-grid"><label>Операция<select aria-label="Операция" value={kind} disabled={!!source} onChange={e => { const k = e.target.value as CashflowKind; setKind(k); setCategory(CASHFLOW_CATEGORIES.find(c => c.kind === k)!.id); }}><option value="income">Поступление</option><option value="expense">Выплата</option><option value="transfer">Перевод</option></select></label>
      <label>Учёт<select aria-label="Учёт" value={status} onChange={e => setStatus(e.target.value as 'actual' | 'planned')}><option value="actual">Факт — деньги уже прошли</option><option value="planned">План — ожидаемая оплата</option></select></label>
      <label>{status === 'actual' ? 'Дата оплаты' : 'Ожидаемая дата'}<input type="date" required value={date} max={status === 'actual' ? cashflowToday() : undefined} onChange={e => setDate(e.target.value)} /></label>
      <label>Сумма, ₽<input inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" /></label>
      <label>{kind === 'income' ? 'Куда поступили деньги' : 'С какого счёта'}<select required value={account} onChange={e => setAccount(e.target.value)}><option value="">Выберите счёт</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {kind === 'transfer' ? <label>На какой счёт<select aria-label="На какой счёт" required value={target} onChange={e => setTarget(e.target.value)}><option value="">Выберите получателя</option>{accounts.filter(a => a.id !== account).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label> : <label>Статья<select aria-label="Статья" value={category} disabled={!!source} onChange={e => setCategory(e.target.value)}>{CASHFLOW_CATEGORIES.filter(c => c.kind === kind).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      <label className="dds-full">Контрагент<input value={counterparty} maxLength={200} onChange={e => setCounterparty(e.target.value)} placeholder="Клиент, сотрудник или поставщик" /></label>
      <label className="dds-full">Назначение / документ<textarea value={comment} maxLength={1000} rows={3} onChange={e => setComment(e.target.value)} placeholder="За что и по какому документу" /></label>
    </div><p className="dds-help">Сумма платежа целиком, включая НДС, если он есть. Перевод между своими счетами сохранится одной операцией.</p>
    {error && <div role="alert" className="dds-notice dds-error">{error}</div>}<div className="dds-form-actions"><button type="submit" className="dds-btn dds-primary">{busy ? 'Сохраняем…' : status === 'planned' ? 'Сохранить план' : 'Подтвердить движение денег'}</button><button type="button" className="dds-btn" onClick={onClose}>Отмена</button></div></fieldset></form></Dialog>;
}
export function CashflowAccountForm({ uid, ready, onClose, onSaved }: { uid: string; ready: boolean; onClose: () => void; onSaved: () => void }) {
  const id = useRef(crypto.randomUUID()), lock = useRef(false);
  const [name, setName] = useState(''), [date, setDate] = useState(cashflowToday()), [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!ready || lock.current) return;
    const openingCents = parseCashflowMoney(amount, true);
    if (openingCents === null) { setError('Укажите начальный остаток, в том числе 0.'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await createCashflowAccount({ id: id.current, name: name.trim(), openedOn: date, openingCents, createdBy: uid }); onSaved(); }
    catch (err) { setError(cashflowError(err)); } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title="Новый счёт или касса" busy={busy} close={onClose}><form onSubmit={e => void submit(e)}><fieldset disabled={busy || !ready}><div className="dds-form-grid"><label className="dds-full">Название<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Например, расчётный счёт или касса" /></label><label>Начало учёта<input type="date" required value={date} max={cashflowToday()} onChange={e => setDate(e.target.value)} /></label><label>Остаток на начало дня, ₽<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="В том числе 0" /></label></div><p className="dds-help">Возьмите остаток из выписки или пересчитайте кассу. После сохранения начальный остаток фиксируется; проверьте его до начала ввода операций.</p>{error && <div role="alert" className="dds-notice dds-error">{error}</div>}<div className="dds-form-actions"><button className="dds-btn dds-primary" type="submit">{busy ? 'Сохраняем…' : 'Начать учёт счёта'}</button><button className="dds-btn" type="button" onClick={onClose}>Отмена</button></div></fieldset></form></Dialog>;
}
export function CashflowActionForm({ entry, action, uid, ready, onClose, onSaved }: { entry: CashflowEntry; action: 'post' | 'void'; uid: string; ready: boolean; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(cashflowToday()), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false); const lock = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setError('');
    try { if (action === 'post') await postCashflowPlan(entry, date, uid); else await voidCashflowEntry(entry, reason, uid); onSaved(); }
    catch (err) { setError(cashflowError(err)); } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={action === 'post' ? 'Подтвердить оплату плана' : 'Аннулировать операцию'} busy={busy} close={onClose}><form onSubmit={e => void submit(e)}><fieldset disabled={busy || !ready}><p className="dds-action-review">{entry.counterparty || entry.comment || 'Денежная операция'}<strong>{cashflowMoney(entry.amountCents)}</strong></p>{action === 'post' ? <label>Фактическая дата оплаты<input type="date" value={date} required max={cashflowToday()} onChange={e => setDate(e.target.value)} /></label> : <><p className="dds-help">Запись останется в истории и перестанет влиять на остатки. Возврат денег клиенту оформляйте отдельной выплатой, а не аннулированием реальной оплаты.</p><label>Причина<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} rows={3} /></label></>}{error && <div role="alert" className="dds-notice dds-error">{error}</div>}<div className="dds-form-actions"><button type="submit" className={`dds-btn ${action === 'void' ? 'dds-danger' : 'dds-primary'}`}>{busy ? 'Сохраняем…' : action === 'post' ? 'Деньги прошли — провести' : 'Аннулировать с причиной'}</button><button className="dds-btn" type="button" onClick={onClose}>Отмена</button></div></fieldset></form></Dialog>;
}
