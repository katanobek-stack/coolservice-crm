import { useState } from 'react';
import type { SourceStatus } from '../../shared/context/dataReadiness';
import type { ServiceController, ServiceControllerCommand, ServiceControllerLog, ServiceCommandRecord } from '../../shared/types/serviceMonitor';
import { Input, Select } from '../../shared/ui/Input';
import { SERVICE_STATE_LABELS, selectServiceControllers, serviceContact, serviceHealth, serviceRelative, serviceSummary, type ServiceFeed, type ServiceFilters, type ServiceState } from './serviceMonitorLogic';
import { ServiceCommandPanel, ServiceDiagnostics, ServiceLogPanel, type ServiceCommandFeedback } from './ServiceControllerPanels';
import './serviceMonitor.css';

export interface ServiceWorkspaceProps {
  controllers: ServiceController[]; status: SourceStatus; selectedId: string | null; nowMs: number; role: string;
  logs: ServiceFeed<ServiceControllerLog>; commands: ServiceFeed<ServiceCommandRecord>; commandBusy: boolean; feedback: ServiceCommandFeedback | null;
  onSelect(id: string): void; onRetry(): void; onCommand(command: ServiceControllerCommand): void;
}
const initialFilters: ServiceFilters = { search: '', state: 'all', attention: false, sort: 'attention' };

export function ServiceMonitorWorkspace(props: ServiceWorkspaceProps) {
  const [filters, setFilters] = useState<ServiceFilters>(initialFilters);
  const [limit, setLimit] = useState(30);
  const patch = (values: Partial<ServiceFilters>) => { setFilters(current => ({ ...current, ...values })); setLimit(30); };
  const ready = props.status === 'ready';
  const controllers = ready ? props.controllers : [];
  const stats = serviceSummary(controllers, props.nowMs);
  const visible = selectServiceControllers(controllers, filters, props.nowMs);
  const selected = controllers.find(c => c.id === props.selectedId) ?? null;
  return <section className="svc-workspace" aria-label="Сервисный монитор">
    <header className="svc-header"><div><span className="svc-eyebrow">Контроль оборудования</span><h1>Сервисный монитор</h1><p>Связь, диагностика и события контроллеров — от общего состояния до причины сбоя.</p><span className="svc-header-caption">Автообновление · Статус связи за 5 минут · Владивосток, UTC+10</span></div><button type="button" onClick={props.onRetry}><i className="ti ti-refresh" aria-hidden="true"/> Обновить данные</button></header>
    <div className="svc-overview" role="group" aria-label="Сводка контроллеров">{[
      { title: 'Всего контроллеров', value: stats.total, icon: 'ti-cpu', tone: 'blue', active: filters.state === 'all' && !filters.attention, apply: () => patch({ state: 'all', attention: false }) },
      { title: 'На связи', value: stats.online, icon: 'ti-broadcast', tone: 'green', active: filters.state === 'online' && !filters.attention, apply: () => patch({ state: 'online', attention: false }) },
      { title: 'Требуют внимания', value: stats.attention, icon: 'ti-alert-triangle', tone: 'amber', active: filters.attention, apply: () => patch({ state: 'all', attention: true }) },
      { title: 'Отключены в реестре', value: stats.disabled, icon: 'ti-plug-off', tone: 'slate', active: filters.state === 'disabled', apply: () => patch({ state: 'disabled', attention: false }) },
    ].map(tile => <button type="button" className={`svc-kpi is-${tile.tone}`} key={tile.title} disabled={!ready} aria-pressed={tile.active} onClick={tile.apply}><i className={`ti ${tile.icon}`} aria-hidden="true"/><span>{tile.title}</span><strong>{ready ? tile.value : '—'}</strong></button>)}</div>
    <section className="svc-toolbar" aria-label="Поиск и фильтры контроллеров"><label className="svc-search">Поиск контроллера<Input type="search" value={filters.search} onChange={e => patch({ search: e.target.value })} placeholder="Название, объект, ID или прошивка"/></label><label>Статус связи<Select aria-label="Статус связи" value={filters.state} onChange={e => patch({ state: e.target.value as ServiceFilters['state'] })}><option value="all">Все статусы</option>{(Object.keys(SERVICE_STATE_LABELS) as ServiceState[]).map(state => <option key={state} value={state}>{SERVICE_STATE_LABELS[state]}</option>)}</Select></label><label>Порядок<Select aria-label="Порядок контроллеров" value={filters.sort} onChange={e => patch({ sort: e.target.value as ServiceFilters['sort'] })}><option value="attention">Сначала требующие внимания</option><option value="name">По названию: А–Я</option><option value="recent">По последнему контакту</option></Select></label><label className="svc-attention-toggle"><input type="checkbox" checked={filters.attention} onChange={e => patch({ attention: e.target.checked })}/>Требуют внимания</label><div className="svc-toolbar-footer"><span aria-live="polite">{ready ? `Найдено: ${visible.length} из ${stats.total}` : 'Данные ещё не подтверждены'}</span><button type="button" onClick={() => { setFilters(initialFilters); setLimit(30); }}>Сбросить фильтры</button></div></section>
    {!ready ? <div className={`svc-source-message svc-registry-message ${props.status === 'error' ? 'is-error' : ''}`} role={props.status === 'error' ? 'alert' : 'status'}><strong>{props.status === 'error' ? 'Не удалось загрузить контроллеры' : 'Загружаем сервисные контроллеры…'}</strong><p>{props.status === 'error' ? 'Данные не подтверждены. Проверьте подключение и нажмите «Обновить данные».' : 'Параметры и журнал появятся после подключения.'}</p></div> : !controllers.length ? <div className="svc-source-message svc-registry-message"><i className="ti ti-cpu" aria-hidden="true"/><strong>Сервисных контроллеров пока нет</strong><p>Они появятся после регистрации администратором. Температурные устройства находятся в разделе «Мониторинг».</p></div> : <div className="svc-workbench"><aside className="svc-fleet" aria-label="Список контроллеров"><div className="svc-fleet-heading"><h2>Контроллеры</h2><span>{visible.length}</span></div><div className="svc-fleet-list">{!visible.length ? <div className="svc-source-message"><strong>Ничего не найдено</strong><p>Измените поиск или сбросьте фильтры.</p></div> : visible.slice(0, limit).map(controller => {
      const health = serviceHealth(controller, props.nowMs);
      return <button type="button" key={controller.id} className={`svc-controller is-${health.state}`} aria-pressed={controller.id === props.selectedId} onClick={() => props.onSelect(controller.id)}><div><span className="svc-controller-icon"><i className="ti ti-cpu" aria-hidden="true"/></span><strong>{controller.name}</strong><i className="ti ti-chevron-right" aria-hidden="true"/></div><p>{controller.objectName}</p><code>{controller.deviceId}</code><div className="svc-controller-bottom"><span className={`svc-status is-${health.state}`}>{SERVICE_STATE_LABELS[health.state]}</span><small>{serviceRelative(serviceContact(controller), props.nowMs)}</small></div>{health.attention && <span className="svc-controller-issue">{health.issues[0]}</span>}</button>;
    })}{visible.length > limit && <button className="svc-more" type="button" onClick={() => setLimit(current => current + 30)}>Показать ещё · {visible.length - limit}</button>}</div></aside>
    <div className="svc-detail">{selected ? <>{!visible.some(c => c.id === selected.id) && <p className="svc-inline-note">Выбранный контроллер скрыт текущими фильтрами. Его диагностика остаётся открытой.</p>}<ServiceDiagnostics controller={selected} nowMs={props.nowMs}/><ServiceCommandPanel controller={selected} role={props.role} nowMs={props.nowMs} busy={props.commandBusy} feedback={props.feedback} history={props.commands} onCommand={props.onCommand} onRetry={props.onRetry}/><ServiceLogPanel key={selected.id} controller={selected} feed={props.logs} onRetry={props.onRetry}/></> : <div className="svc-source-message">Выберите контроллер, чтобы открыть диагностику и журнал.</div>}</div></div>}
  </section>;
}
