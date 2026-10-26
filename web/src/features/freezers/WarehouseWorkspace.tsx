import { useMemo, useState } from "react";
import type { Freezer } from "../../shared/types/freezer";
import type { SourceStatus } from "../../shared/context/dataReadiness";
import { FreezerCard } from "./FreezerCard";
import { businessDate, defaultWarehouseFilters, freezerName, isRented, money, paymentLabel, paymentState, selectFreezers, warehouseSummary, type WarehouseFilters } from "./warehouseLogic";
import "./warehouse.css";

interface Props {
  freezers: Freezer[];
  status: SourceStatus;
  manager: boolean;
  today?: string;
  onOpen: (freezer: Freezer) => void;
  onAdd: () => void;
}

export function WarehouseWorkspace({ freezers, status, manager, today = businessDate(), onOpen, onAdd }: Props) {
  const [filters, setFilters] = useState<WarehouseFilters>(defaultWarehouseFilters);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [grouping, setGrouping] = useState<"none" | "status">("none");
  const [limit, setLimit] = useState(24);
  const patch = (value: Partial<WarehouseFilters>) => { setFilters(f => ({ ...f, ...value })); setLimit(24); };
  const reset = () => { setFilters(defaultWarehouseFilters); setLimit(24); };
  const ready = status === "ready";
  const summary = useMemo(() => warehouseSummary(ready ? freezers : [], today), [freezers, today, ready]);
  const rows = useMemo(() => selectFreezers(ready ? freezers : [], filters, today), [freezers, filters, today, ready]);
  const types = useMemo(() => [...new Set(freezers.map(f => f.type || "Тип не указан"))].sort((a, b) => a.localeCompare(b, "ru")), [freezers]);
  const shown = rows.slice(0, limit);
  const groups = grouping === "status" && filters.status === "all"
    ? [{ title: "Свободны для аренды", rows: shown.filter(f => !isRented(f)), key: "available" }, { title: "В аренде", rows: shown.filter(isRented), key: "rented" }]
    : [{ title: filters.status === "available" ? "Свободны для аренды" : filters.status === "rented" ? "В аренде" : "Оборудование", rows: shown, key: "all" }];
  const hasFilters = filters.search || filters.type !== "all" || filters.status !== "all" || filters.attention !== "all" || filters.sort !== "name";

  return <div className="warehouse-workspace">
    <header className="warehouse-header">
      <div><p className="warehouse-eyebrow">ОБОРУДОВАНИЕ И АРЕНДА</p><h1>Склад</h1><p>Камеры, арендаторы и условия аренды — в одном рабочем пространстве.</p></div>
      {manager && <button className="warehouse-primary" type="button" onClick={onAdd} disabled={!ready}><i className="ti ti-plus" aria-hidden="true" />Добавить камеру</button>}
    </header>

    <section className="warehouse-summary" aria-label="Сводка склада">
      <button type="button" className="warehouse-stat" disabled={!ready} aria-pressed={filters.status === "all" && filters.attention === "all"} onClick={() => patch({ status: "all", attention: "all" })}><span>Всего камер</span><strong>{ready ? summary.total : "—"}</strong><small>Оборудование на балансе</small></button>
      <button type="button" className="warehouse-stat warehouse-stat--teal" disabled={!ready} aria-pressed={filters.status === "available"} onClick={() => patch({ status: "available", attention: "all" })}><span>Свободны</span><strong>{ready ? summary.available : "—"}</strong><small>Доступны для новой аренды</small></button>
      <button type="button" className="warehouse-stat warehouse-stat--blue" disabled={!ready} aria-pressed={filters.status === "rented" && filters.attention === "all"} onClick={() => patch({ status: "rented", attention: "all" })}><span>В аренде</span><strong>{ready ? summary.rented : "—"}</strong><small>Действующие арендаторы</small></button>
      <button type="button" className="warehouse-stat warehouse-stat--amber" disabled={!ready} aria-pressed={filters.attention === "overdue"} onClick={() => patch({ status: "rented", attention: "overdue" })}><span>Проверить оплату</span><strong>{ready ? summary.overdue : "—"}</strong><small>Указанная дата оплаты прошла</small></button>
    </section>

    {ready && <div className="warehouse-lease-strip"><span><i className="ti ti-snowflake" aria-hidden="true" /><strong>Парк оборудования</strong><span>{summary.rented} из {summary.total} в аренде</span></span><div className="warehouse-occupancy" aria-label={`В аренде ${summary.rented} из ${summary.total}`}><span style={{ width: `${summary.total ? summary.rented / summary.total * 100 : 0}%` }} /></div>{manager && <span className="warehouse-monthly"><span>Аренда в месяц</span><strong>{money(summary.monthly)}</strong><small>По текущим ставкам, не поступления</small></span>}</div>}

    <section className="warehouse-catalog" aria-label="Каталог оборудования">
      <div className="warehouse-catalog-heading"><div><h2>Холодильные камеры</h2><p>Выберите камеру, чтобы открыть оборудование и историю аренды.</p></div><span className="warehouse-count">{ready ? `${summary.total} ед.` : "—"}</span></div>
      <div className="warehouse-navigation"><nav aria-label="Статус аренды">{([{ id: "all", label: "Все камеры", count: summary.total }, { id: "available", label: "Свободны", count: summary.available }, { id: "rented", label: "В аренде", count: summary.rented }] as const).map(item => <button type="button" key={item.id} disabled={!ready} aria-current={filters.status === item.id ? "page" : undefined} onClick={() => patch({ status: item.id, attention: "all" })}>{item.label}<span>{ready ? item.count : "—"}</span></button>)}</nav><div className="warehouse-view" aria-label="Вид каталога"><button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><i className="ti ti-layout-grid" aria-hidden="true" />Карточки</button><button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}><i className="ti ti-list" aria-hidden="true" />Таблица</button></div></div>
      <div className="warehouse-toolbar"><label className="warehouse-search">Поиск оборудования<input type="search" placeholder="Название, адрес, арендатор или телефон…" value={filters.search} onChange={e => patch({ search: e.target.value })} disabled={!ready} /></label><label>Тип оборудования<select value={filters.type} onChange={e => patch({ type: e.target.value })} disabled={!ready}><option value="all">Все типы</option>{types.map(type => <option key={type}>{type}</option>)}</select></label><label>Оплата<select value={filters.attention} onChange={e => patch({ attention: e.target.value as WarehouseFilters["attention"] })} disabled={!ready}><option value="all">Любое состояние</option><option value="overdue">Проверить оплату</option><option value="unknown">Дата не указана</option></select></label><label>Сортировка<select value={filters.sort} onChange={e => patch({ sort: e.target.value as WarehouseFilters["sort"] })} disabled={!ready}><option value="name">Название: А–Я</option><option value="payment">Ближайшая оплата</option><option value="volume">Сначала больший объём</option></select></label><label>Группировка<select disabled={view === "table" || !ready} value={grouping} onChange={e => setGrouping(e.target.value as "none" | "status")}><option value="none">Общий каталог</option><option value="status">По статусу аренды</option></select></label></div>
      {ready && <div className="warehouse-results"><span role="status">Найдено: <strong>{rows.length}</strong> из {summary.total}{grouping === "status" && filters.status === "all" ? " · по статусу аренды" : ""}</span>{hasFilters && <button type="button" onClick={reset}>Сбросить фильтры</button>}{!hasFilters && summary.unknown > 0 && <button type="button" onClick={() => patch({ status: "rented", attention: "unknown" })}>Без даты оплаты: {summary.unknown}</button>}</div>}
      {!ready ? <div className="warehouse-empty" role={status === "error" ? "alert" : "status"}><i className={`ti ${status === "error" ? "ti-cloud-off" : "ti-loader"}`} aria-hidden="true" /><h3>{status === "error" ? "Не удалось загрузить склад" : "Загружаем оборудование"}</h3><p>{status === "error" ? "Проверьте подключение. Если данные не появились, обновите страницу." : "Камеры и состояние аренды появятся после загрузки."}</p></div>
        : rows.length === 0 ? <div className="warehouse-empty"><i className="ti ti-package" aria-hidden="true" /><h3>{summary.total ? "Камеры не найдены" : "На складе пока нет оборудования"}</h3><p>{summary.total ? "Измените запрос или сбросьте фильтры." : "Добавьте первую камеру, чтобы вести оборудование и аренду."}</p>{summary.total > 0 && <button type="button" className="warehouse-secondary" onClick={reset}>Показать все камеры</button>}</div>
          : view === "cards" ? <div className="warehouse-groups">{groups.filter(g => g.rows.length > 0).map(group => <section key={group.key} className={`warehouse-group warehouse-group--${group.key}`}><div className="warehouse-group-heading"><span /><h3>{group.title}</h3><small>{group.rows.length} ед.</small></div><div className="freezer-grid">{group.rows.map(f => <div key={f.id} className="warehouse-card-wrap"><FreezerCard freezer={f} onClick={() => onOpen(f)} /><div className={`warehouse-card-payment warehouse-payment--${paymentState(f, today)}`}><i className={`ti ${isRented(f) ? "ti-calendar" : "ti-check"}`} aria-hidden="true" /><span>{paymentLabel(f, today)}</span></div></div>)}</div></section>)}</div>
            : <div className="warehouse-table-scroll"><table className="warehouse-table"><caption className="warehouse-sr">Оборудование и состояние аренды</caption><thead><tr><th>Оборудование</th><th>Статус</th><th>Арендатор</th><th>Объём</th><th>Оплата</th><th><span className="warehouse-sr">Действия</span></th></tr></thead><tbody>{shown.map(f => <tr key={f.id}><td><strong>{freezerName(f)}</strong><small>{f.type || "Тип не указан"}</small><small>{f.location || "Адрес не указан"}</small></td><td><span className={`warehouse-badge ${isRented(f) ? "warehouse-badge--blue" : ""}`}>{isRented(f) ? "В аренде" : "Свободна"}</span></td><td>{isRented(f) ? f.tenant || "Не указан" : "—"}<small>{isRented(f) ? f.tenantPhone || "Телефон не указан" : ""}</small></td><td>{f.volume != null ? `${f.volume} м³` : "—"}</td><td><span className={`warehouse-payment--${paymentState(f, today)}`}>{paymentLabel(f, today)}</span></td><td><button type="button" className="warehouse-secondary" aria-label={`Открыть камеру: ${freezerName(f)}`} onClick={() => onOpen(f)}>Открыть ↗</button></td></tr>)}</tbody></table></div>}
      {ready && rows.length > shown.length && <div className="warehouse-more"><button className="warehouse-secondary" type="button" onClick={() => setLimit(n => n + 24)}>Показать ещё {Math.min(24, rows.length - shown.length)}</button><span>Показано {shown.length} из {rows.length}</span></div>}
    </section>
    <footer className="warehouse-footnote">Движение вентиляторов и снег обозначают аренду. Заданная температура в карточке не является показанием датчика.</footer>
  </div>;
}
