import type { CashflowAccount, CashflowEntry, CashflowReport } from './cashflowLogic';
import { cashflowCategory, cashflowMoney } from './cashflowLogic';

export const cashflowDateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
export function CashflowSummary({ report }: { report: CashflowReport | null }) {
  return <div className="dds-summary" aria-label="Движение денег за месяц">
    <article className="dds-kpi"><span>На начало месяца</span><strong>{report ? cashflowMoney(report.openingCents) : '—'}</strong><small>По выбранным счетам</small></article>
    <article className="dds-kpi dds-income"><span>Поступило</span><strong>{report ? cashflowMoney(report.incomeCents) : '—'}</strong><small>Подтверждённые оплаты</small></article>
    <article className="dds-kpi dds-expense"><span>Выплачено</span><strong>{report ? cashflowMoney(report.expenseCents) : '—'}</strong><small>Фактические платежи</small></article>
    <article className={`dds-kpi dds-balance ${report && report.closingCents < 0 ? 'dds-negative' : ''}`}><span>{report?.closingCents !== undefined && report.closingCents < 0 ? 'Отрицательный остаток' : 'На конец периода'}</span><strong>{report ? cashflowMoney(report.closingCents) : '—'}</strong><small>Для текущего месяца — на сегодня</small></article>
  </div>;
}
export function CashflowOverview({ report }: { report: CashflowReport }) {
  const rows = report.categories.filter(c => c.actualCents || c.plannedCents);
  return <>
    {(report.introducedCents !== 0 || report.transferCents !== 0) && <div className="dds-notice">Начальные остатки счетов, введённых в периоде: <b>{cashflowMoney(report.introducedCents)}</b>. Переводы по выбранному счёту: <b>{cashflowMoney(report.transferCents)}</b>. Они включены в конечный остаток отдельно от поступлений и выплат.</div>}
    <section className="dds-panel"><header><div><h2>Куда приходят и уходят деньги</h2><p>План и факт за выбранный месяц. Положительное отклонение выплат означает превышение плана.</p></div></header>
      {!rows.length ? <p className="dds-empty">За этот месяц пока нет операций. Добавьте оплату или запланируйте платёж.</p> : <div className="dds-scroll"><table className="dds-table"><thead><tr><th>Статья</th><th>Деятельность</th><th className="dds-numeric">План</th><th className="dds-numeric">Факт</th><th className="dds-numeric">Факт − план</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td><b>{c.label}</b><small>{c.kind === 'income' ? 'Поступления' : 'Выплаты'}</small></td><td>{c.activity}</td><td className="dds-numeric">{cashflowMoney(c.plannedCents)}</td><td className={`dds-numeric ${c.kind === 'income' ? 'dds-text-income' : 'dds-text-expense'}`}>{cashflowMoney(c.actualCents)}</td><td className="dds-numeric">{cashflowMoney(c.actualCents - c.plannedCents)}</td></tr>)}</tbody></table></div>}
    </section>
    <div className="dds-explainer"><h2>Сначала — движение денег</h2><p>Стоимость закрытой заявки помогает заполнить оплату. Зарплата и аренда становятся выплатой после подтверждения. Закупки деталей учитываются как денежные расходы; себестоимость склада и прибыль по работам подключим отдельно.</p></div>
  </>;
}
export function CashflowForecast({ report }: { report: CashflowReport }) {
  return <section className="dds-panel"><header><div><h2>Денег хватит на ближайшие 13 недель?</h2><p>Прогноз от сегодняшнего остатка по выбранным счетам и внесённым планам. Просроченные планы включены в первую неделю. Ожидаемые поступления ещё не получены.</p></div></header><div className="dds-scroll"><table className="dds-table"><thead><tr><th>Неделя</th><th className="dds-numeric">Поступления</th><th className="dds-numeric">Выплаты</th><th className="dds-numeric">Ожидаемый остаток</th></tr></thead><tbody>{report.forecast.map(row => <tr key={row.from}><td>{cashflowDateLabel(row.from)} — {cashflowDateLabel(row.through)}{row.transferCents !== 0 && <small>Переводы: {cashflowMoney(row.transferCents)}</small>}</td><td className="dds-numeric">{cashflowMoney(row.inCents)}</td><td className="dds-numeric">{cashflowMoney(row.outCents)}</td><td className={`dds-numeric ${row.balanceCents < 0 ? 'dds-text-expense' : ''}`}>{row.balanceCents < 0 && <small>Недостаточно денег</small>}{cashflowMoney(row.balanceCents)}</td></tr>)}</tbody></table></div></section>;
}
export function CashflowJournal({ entries, accounts, onPost, onVoid, disabled = false }: {
  entries: readonly CashflowEntry[]; accounts: readonly CashflowAccount[]; onPost?: (entry: CashflowEntry) => void; onVoid?: (entry: CashflowEntry) => void; disabled?: boolean;
}) {
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  if (!entries.length) return <p className="dds-empty">Операций по этим условиям нет.</p>;
  return <div className="dds-journal">{entries.map(e => <article className={`dds-operation dds-operation-${e.kind} ${e.status === 'void' ? 'dds-void' : ''}`} key={e.id}>
    <div className="dds-operation-body"><div className="dds-operation-meta"><span className={`dds-tag dds-tag-${e.status}`}>{{ actual: 'Факт', planned: 'План', void: 'Аннулировано' }[e.status]}</span><span>{cashflowDateLabel(e.date)}</span><span>{accountName(e.accountId)}{e.kind === 'transfer' && ` → ${accountName(e.targetAccountId)}`}</span></div>
      <h3>{cashflowCategory(e.category)?.label ?? e.category}{e.counterparty && ` · ${e.counterparty}`}</h3><p>{e.comment || 'Без назначения'}</p>{e.sourceKey && <small>Связано с {{ manual: 'ручной записью', repair: 'закрытой заявкой', salary: 'зарплатой', rent: 'арендой бокса', rental: 'арендой камеры', subscription: 'абонплатой' }[e.sourceType]}</small>}{e.plannedDate && <small>Было запланировано на {cashflowDateLabel(e.plannedDate)}</small>}{e.voidReason && <small>Причина: {e.voidReason}</small>}
    </div><strong className={e.kind === 'income' ? 'dds-text-income' : e.kind === 'expense' ? 'dds-text-expense' : ''}>{e.kind === 'income' ? '+' : e.kind === 'expense' ? '−' : ''}{cashflowMoney(e.amountCents)}</strong><div className="dds-operation-actions">{e.status === 'planned' && onPost && <button type="button" className="dds-btn dds-primary" disabled={disabled} onClick={() => onPost(e)}>Провести оплату</button>}{e.status !== 'void' && onVoid && <button type="button" className="dds-btn dds-subtle" disabled={disabled} onClick={() => onVoid(e)}>Аннулировать</button>}</div>
  </article>)}</div>;
}
