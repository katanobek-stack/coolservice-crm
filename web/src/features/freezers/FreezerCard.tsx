import { EquipmentScene } from "./EquipmentScene";
import type { Freezer } from "../../shared/types/freezer";
import "./freezers.css";

export function FreezerCard({ freezer, onClick }: { freezer: Freezer; onClick: () => void }) {
  const rented = freezer.rented === true || freezer.status === "rented";
  const name = freezer.name?.trim() || freezer.type || "Камера";
  return (
    <button type="button" className={`freezer-card ${rented ? "is-rented" : "is-available"}`} onClick={onClick} aria-label={`Открыть камеру: ${name}`}>
      <div className="freezer-card-top">
        <span className="freezer-card-type">{freezer.type || "Холодильное оборудование"}</span>
        <span className="freezer-card-status"><span />{rented ? "В аренде" : "Свободна"}</span>
      </div>
      <div className="freezer-card-scene">
        <EquipmentScene key={freezer.type} type={freezer.type} />
        <span className="freezer-card-scene-label" title="Движение обозначает активную аренду. Фактическая работа оборудования не проверяется.">{rented ? "Анимация аренды · не телеметрия" : "Образ оборудования"}</span>
      </div>
      <div className="freezer-card-body">
        <div className="freezer-card-title-row"><h3>{name}</h3><span className="freezer-card-open" aria-hidden="true">↗</span></div>
        <div className="freezer-card-location"><i className="ti ti-map-pin" aria-hidden="true" />{freezer.location?.trim() || "Расположение не указано"}</div>
        <div className="freezer-card-specs">
          <div><span>Объём</span><strong>{freezer.volume != null ? `${freezer.volume.toLocaleString("ru-RU")} м³` : "Не указан"}</strong></div>
          <div><span>Температура · заданная</span><strong>{freezer.temp?.trim() || "Не указана"}</strong></div>
        </div>
        <div className="freezer-card-contact">
          <div><span>Арендатор</span><strong>{rented ? (freezer.tenant?.trim() || "Не указан") : "Нет · камера свободна"}</strong></div>
          <div><span>Телефон</span><strong>{rented ? (freezer.tenantPhone?.trim() || "Не указан") : "—"}</strong></div>
        </div>
      </div>
    </button>
  );
}
