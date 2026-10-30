import type { ReactNode } from 'react';
import { pnlMoney, type PnlMonth } from './pnlLogic';
export function PnlSourceBoundary({ ready, error, children }: {
    ready: boolean;
    error: boolean;
    children: ReactNode;
}) {
    return <>{!ready && <div className={`pnl-notice ${error ? 'pnl-notice-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? 'Не удалось получить финансовые данные. Итоги и сохранение временно недоступны; введённые значения сохранены. После восстановления связи проверьте данные перед повторным сохранением.' : 'Загружаем доходы и расходы. Итоги появятся после получения всех данных.'}</div>}<fieldset className="pnl-source-boundary" disabled={!ready}>{children}</fieldset></>;
}
export function PnlSummary({ report, onIncome, onExpenses }: {
    report: PnlMonth | null;
    onIncome?: () => void;
    onExpenses?: () => void;
}) {
    const m = report;
    return <div className="pnl-summary" aria-label="Итоги выбранного месяца">
  <article className="pnl-kpi pnl-income"><span>Доходы</span><strong>{m ? pnlMoney(m.income) : '—'}</strong><p>{m ? `${m.repairs.length} выполненных заявок + аренда камер` : 'Ожидаем данные'}</p>{onIncome && <button type="button" onClick={onIncome} disabled={!m}>Посмотреть доходы</button>}</article>
  <article className="pnl-kpi pnl-expense"><span>Расходы</span><strong>{m ? pnlMoney(m.totalExpenses) : '—'}</strong><p>Постоянные расходы, электричество и операции</p>{onExpenses && <button type="button" onClick={onExpenses} disabled={!m}>Посмотреть расходы</button>}</article>
  <article className={`pnl-kpi pnl-result ${m && m.profit < 0 ? 'pnl-loss' : ''}`}><span>{m ? (m.profit < 0 ? 'Убыток' : 'Прибыль') : 'Результат'}</span><strong>{m ? pnlMoney(m.profit) : '—'}</strong><p>{m ? (m.margin === null ? 'Маржа не рассчитывается без дохода' : `Маржа ${m.margin.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% от доходов`) : 'Доходы минус расходы'}</p><small>По учтённым статьям</small></article>
 </div>;
}
export function PnlPanel({ title, description, children, className = '', action }: {
    title: string;
    description?: string;
    children: ReactNode;
    className?: string;
    action?: ReactNode;
}) { return <section className={`pnl-panel ${className}`}><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>; }
export function PnlFeedback({ error, success }: {
    error?: string;
    success?: string;
}) { return <>{error && <div className="pnl-notice pnl-notice-error" role="alert">{error}</div>}{success && <div className="pnl-notice pnl-notice-success" role="status">{success}</div>}</>; }
export const pnlError = (e: unknown) => e instanceof Error ? e.message : 'Не удалось сохранить. Проверьте соединение и повторите действие.';
