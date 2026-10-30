import { useState } from 'react';
import type { StaffMember, StaffRole } from '../../shared/types/staff';
import type { SourceStatus } from '../../shared/context/dataReadiness';
import { Input, Select } from '../../shared/ui/Input';
import { shiftMonth } from '../../shared/utils/finance';
import { effectivePermissions, PERMISSION_LABELS, ROLE_LABELS, selectStaff, staffEditPolicy, staffName, staffRole, type StaffFilters, type StaffResult } from './staffLogic';
import './staff.css';

interface Props {
  rows: StaffResult[];
  staffStatus: SourceStatus;
  resultsStatus: SourceStatus;
  workStatus: SourceStatus;
  month: string;
  onMonthChange(month: string): void;
  actorId: string;
  actorRole: StaffRole;
  showAmounts: boolean;
  onEdit(member: StaffMember): void;
}
const initialFilters: StaffFilters = { search: '', role: 'all', activity: 'all', sort: 'role' };
const money = (value: number) => `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const unavailable = (status: SourceStatus) => status === 'error' ? 'Недоступно' : 'Загрузка';
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00+10:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Asia/Vladivostok' });

function StaffCard({ row, props }: { row: StaffResult; props: Props }) {
  const { member } = row;
  const role = staffRole(member);
  const policy = staffEditPolicy(props.actorId, props.actorRole, member);
  const resultsReady = props.resultsStatus === 'ready';
  const permissions = effectivePermissions(member);
  return <article className={`staff-card staff-tone-${role}`}>
    <div className="staff-card-top"><span className="staff-avatar" aria-hidden="true">{staffName(member).slice(0, 1).toLocaleUpperCase('ru')}</span><div className="staff-identity"><h3>{staffName(member)}</h3><span className="staff-email">{member.email || 'Email не указан'}</span></div>{member.id === props.actorId && <span className="staff-self">Вы</span>}</div>
    <div className="staff-card-badges"><span className="staff-role">{ROLE_LABELS[role]}</span>{props.showAmounts && resultsReady && row.rank && <span className="staff-rank">Место в рейтинге: {row.rank}{row.tied ? ' · поровну' : ''}</span>}</div>
    <dl className="staff-card-metrics"><div><dt>В работе сейчас</dt><dd>{props.workStatus === 'ready' ? row.active : unavailable(props.workStatus)}</dd></div><div><dt>Закрыто за месяц</dt><dd>{resultsReady ? row.closed : unavailable(props.resultsStatus)}</dd></div></dl>
    {props.showAmounts && <div className="staff-result"><span>Доля выручки за месяц</span><strong>{resultsReady ? money(row.total) : unavailable(props.resultsStatus)}</strong></div>}
    {role === 'admin' && props.actorRole === 'owner' && <div className="staff-access-summary"><strong>Финансовый доступ</strong>{(Object.keys(PERMISSION_LABELS) as (keyof typeof PERMISSION_LABELS)[]).map(key => <span key={key}><span>{PERMISSION_LABELS[key]}</span><b className={permissions[key] ? 'is-enabled' : ''}>{permissions[key] ? 'Открыт' : 'Закрыт'}</b></span>)}</div>}
    <div className="staff-card-actions">{policy.name && <button type="button" className="staff-edit" onClick={() => props.onEdit(member)} aria-label={`Редактировать сотрудника ${staffName(member)}`}>Редактировать <span aria-hidden="true">↗</span></button>}
      {resultsReady && <details className="staff-breakdown"><summary>Работы за месяц <span>{row.closed}</span></summary><div className="staff-breakdown-content">{!row.repairs.length ? <p>За этот месяц закрытых заявок с участием сотрудника нет.</p> : <ul>{row.repairs.map(repair => <li key={repair.key}><strong>{repair.clientName}</strong><span>{repair.title}</span><small>{repair.date.split('-').reverse().join('.')} · Исполнителей: {repair.participants}</small>{props.showAmounts && <div><span>Заявка: {money(repair.cost)}</span><b>Доля: {money(repair.share)}</b></div>}</li>)}</ul>}</div></details>}
    </div>
  </article>;
}

export function StaffWorkspace(props: Props) {
  const [filters, setFilters] = useState<StaffFilters>(initialFilters);
  const [limit, setLimit] = useState(24);
  const staffReady = props.staffStatus === 'ready';
  const resultsReady = props.resultsStatus === 'ready';
  const workReady = props.workStatus === 'ready';
  const patch = (values: Partial<StaffFilters>) => { setFilters(current => ({ ...current, ...values })); setLimit(24); };
  // Data readiness and permission changes must also invalidate a previously selected sort/filter.
  const safeFilters: StaffFilters = { ...filters, activity: workReady ? filters.activity : 'all', sort: filters.sort === 'result' && (!props.showAmounts || !resultsReady) || filters.sort === 'active' && !workReady ? 'role' : filters.sort };
  const rows = staffReady ? selectStaff(props.rows, safeFilters) : [];
  const all = staffReady ? props.rows : [];
  const leaders = props.showAmounts && resultsReady ? all.filter(row => row.rank && row.rank <= 3).sort((a, b) => a.rank! - b.rank! || staffName(a.member).localeCompare(staffName(b.member), 'ru')) : [];
  const changed = filters.search || filters.role !== 'all' || filters.activity !== 'all' || filters.sort !== 'role';
  return <section className="staff-workspace" aria-label="Персонал">
    <header className="staff-header"><div><span className="staff-eyebrow">Люди и результаты</span><h1>Команда сервиса<span>Всё начинается с людей.</span></h1><p>Сотрудники, загрузка и результаты работы — в одном месте.</p></div><div className="staff-header-emblem" aria-hidden="true"><i className="ti ti-users-group"/><span>COOLSERVICE / TEAM</span></div></header>
    <div className="staff-overview" aria-label="Сводка по команде">
      <div><span className="staff-kpi-icon is-blue"><i className="ti ti-users" aria-hidden="true"/></span><dl><dt>Всего сотрудников</dt><dd>{staffReady ? all.length : '—'}</dd></dl></div>
      <div><span className="staff-kpi-icon is-purple"><i className="ti ti-tool" aria-hidden="true"/></span><dl><dt>Механиков в команде</dt><dd>{staffReady ? all.filter(row => staffRole(row.member) === 'mechanic').length : '—'}</dd></dl></div>
      <div><span className="staff-kpi-icon is-orange"><i className="ti ti-activity" aria-hidden="true"/></span><dl><dt>Сотрудников с заявками</dt><dd>{staffReady && workReady ? all.filter(row => row.active > 0).length : '—'}</dd></dl></div>
      <div><span className="staff-kpi-icon is-green"><i className="ti ti-checks" aria-hidden="true"/></span><dl><dt>Участий в закрытых заявках</dt><dd>{staffReady && resultsReady ? all.reduce((sum, row) => sum + row.closed, 0) : '—'}</dd></dl></div>
    </div>
    <section className="staff-period" aria-label="Период результатов"><div><h2>Результаты команды</h2><p>Закрытые заявки за {monthLabel(props.month)}. Загрузка — на текущий момент.</p></div><div className="staff-month-controls"><button type="button" aria-label="Предыдущий месяц" disabled={props.month <= '2000-01'} onClick={() => props.onMonthChange(shiftMonth(props.month, -1))}>‹</button><label><span className="staff-sr-only">Месяц результатов</span><Input type="month" min="2000-01" max="2100-12" value={props.month} onChange={e => { if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(e.target.value)) props.onMonthChange(e.target.value); }}/></label><button type="button" aria-label="Следующий месяц" disabled={props.month >= '2100-12'} onClick={() => props.onMonthChange(shiftMonth(props.month, 1))}>›</button></div></section>
    {staffReady && (!resultsReady || !workReady) && <div className="staff-notice" role="status">{!resultsReady && <p>{props.resultsStatus === 'error' ? 'Результаты недоступны: не удалось загрузить заявки.' : 'Загружаем результаты по заявкам…'}</p>}{!workReady && <p>{props.workStatus === 'error' ? 'Текущая загрузка недоступна: проверьте подключение и обновите страницу.' : 'Загрузка текущих заявок…'}</p>}</div>}
    {staffReady && props.showAmounts && resultsReady && <section className="staff-leaderboard" aria-label="Рейтинг механиков"><div className="staff-leaderboard-heading"><h2><i className="ti ti-award" aria-hidden="true"/> Рейтинг механиков</h2><p>По доле выручки закрытых заявок</p></div>{leaders.length ? <ol>{leaders.map(row => <li key={row.member.id}><span className={`staff-place is-place-${row.rank}`}>{row.rank}</span><div><strong>{staffName(row.member)}</strong><small>Закрытых заявок: {row.closed}{row.tied ? ' · одинаковый результат' : ''}</small></div><b>{money(row.total)}</b></li>)}</ol> : <p className="staff-leaderboard-empty">Рейтинг появится после закрытия заявок с положительной суммой и назначенными механиками.</p>}<p className="staff-method">Сумма заявки делится поровну между её исполнителями. Это доля выручки, а не зарплата. Совместная заявка учитывается у каждого участника; сумма участий может превышать число заявок.</p></section>}
    <section className="staff-directory" aria-label="Каталог сотрудников"><div className="staff-directory-heading"><div><h2>Сотрудники</h2><p>Найдите коллегу и откройте его результаты или настройки.</p></div><span>{staffReady ? `${all.length} в команде` : 'Ожидаем данные'}</span></div>
      <div className="staff-filters"><label className="staff-search">Поиск сотрудников<Input type="search" placeholder="Имя, email или роль" value={filters.search} onChange={e => patch({ search: e.target.value })}/></label><label>Роль<Select aria-label="Роль" value={filters.role} onChange={e => patch({ role: e.target.value as StaffFilters['role'] })}><option value="all">Все роли</option>{(Object.keys(ROLE_LABELS) as StaffRole[]).map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</Select></label><label>Загрузка сейчас<Select aria-label="Загрузка сейчас" disabled={!workReady} value={safeFilters.activity} onChange={e => patch({ activity: e.target.value as StaffFilters['activity'] })}><option value="all">Все сотрудники</option><option value="active">Есть заявки в работе</option><option value="idle">Без текущих заявок</option></Select></label><label>Сортировка<Select aria-label="Сортировка" value={safeFilters.sort} onChange={e => patch({ sort: e.target.value as StaffFilters['sort'] })}><option value="role">По роли</option><option value="name">По имени: А–Я</option>{workReady && <option value="active">По текущей загрузке</option>}{props.showAmounts && resultsReady && <option value="result">По доле выручки</option>}</Select></label></div>
      <div className="staff-filter-footer"><span aria-live="polite">{staffReady ? `Найдено: ${rows.length}` : 'Данные ещё не подтверждены'}</span>{changed && <button type="button" onClick={() => { setFilters(initialFilters); setLimit(24); }}>Сбросить фильтры</button>}</div>
    </section>
    {!staffReady ? <div className={`staff-empty ${props.staffStatus === 'error' ? 'is-error' : ''}`} role={props.staffStatus === 'error' ? 'alert' : 'status'}><strong>{props.staffStatus === 'error' ? 'Не удалось загрузить сотрудников' : 'Загружаем команду…'}</strong><p>{props.staffStatus === 'error' ? 'Проверьте подключение и обновите страницу. Отсутствие данных не означает, что сотрудников нет.' : 'Карточки появятся после получения данных.'}</p></div> : !rows.length ? <div className="staff-empty"><i className="ti ti-user-search" aria-hidden="true"/><strong>{all.length ? 'По этим условиям никого не нашли' : 'Команда пока пуста'}</strong><p>{all.length ? 'Измените запрос или сбросьте фильтры.' : 'Профиль сотрудника появится после его регистрации в CRM.'}</p></div> : <div className="staff-grid">{rows.slice(0, limit).map(row => <StaffCard key={row.member.id} row={row} props={props}/>)}</div>}
    {rows.length > limit && <button className="staff-more" type="button" onClick={() => setLimit(current => current + 24)}>Показать ещё · Осталось {rows.length - limit}</button>}
    <footer className="staff-help"><i className="ti ti-shield-check" aria-hidden="true"/><p>Роль определяет доступ к разделам. Финансовые разрешения администратора настраивает владелец. Новый сотрудник появляется здесь после регистрации.</p></footer>
  </section>;
}
