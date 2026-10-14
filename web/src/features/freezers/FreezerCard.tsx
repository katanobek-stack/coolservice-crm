import { useId, type CSSProperties } from "react";
import type { Freezer } from "../../shared/types/freezer";
import "./freezers.css";

/** Decorative illustration: dimensions and operation are not inferred from rental status. */
export function FreezerIllustration({ type }: { type?: string }) {
  const id = useId().replace(/:/g, "");
  const freezing = type === "Морозильная камера";
  const container = type === "Рефрижераторный контейнер";
  return (
    <svg viewBox="0 0 440 300" aria-hidden="true" className="freezer-illustration">
      <defs>
        <linearGradient id={`${id}-front`} x2="0.9" y2="1">
          <stop stopColor="#ffffff" /><stop offset="1" stopColor="#dce7ef" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x2="1" y2="1">
          <stop stopColor="#bdcfde" /><stop offset="1" stopColor="#e6eef4" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor={freezing ? "#d9e4ff" : "#cff5f5"} /><stop offset="1" stopColor="#f5f9fc" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="228" cy="150" rx="208" ry="142" fill={`url(#${id}-halo)`} />
      <g fill="none" stroke="#dbe6ef" strokeWidth="1" opacity=".7">
        <path d="M38 242 254 284 406 202M54 220 270 262 406 186M80 208 292 249M108 194 324 236" />
        <path d="M110 270 280 176M162 280 332 186M214 290 384 196" />
      </g>
      <ellipse cx="228" cy="254" rx="142" ry="19" fill="#2d516a" opacity=".09" />
      {/* All planes share the same three projection vectors. */}
      <path d="M92 84 262 118 352 70 182 36Z" fill="#f7fbfe" stroke="#b6cad9" strokeLinejoin="round" />
      <path d="M262 118 352 70 352 215 262 263Z" fill={`url(#${id}-side)`} stroke="#9eb8cc" strokeLinejoin="round" />
      <path d="M92 84 262 118 262 263 92 229Z" fill={`url(#${id}-front)`} stroke="#b6cad9" strokeLinejoin="round" />
      <path d="M92 223 262 257 352 209 352 220 262 268 92 234Z" fill="#819db2" />
      <path d="M96 88 260 121" stroke="#fff" strokeWidth="3" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${277 + i * 15} ${110 - i * 8}v139`} stroke="#91aabd" strokeOpacity=".5" />
      ))}
      <path d="M92 84 262 118 352 70 352 80 262 128 92 94Z" fill="#39566b" />
      <path d="M96 91 260 124" stroke="#6f99b7" strokeWidth="1.5" />
      {container ? (
        <g stroke="#aabfce" strokeWidth="2">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M${104 + i * 21} ${98 + i * 4.2}v117`} />)}
          <path d="M164 100v132M231 114v131" stroke="#68869c" strokeWidth="3" />
          <path d="M155 174 175 178M222 187 242 191" stroke="#48687f" strokeWidth="4" />
        </g>
      ) : (
        <g>
          {/* Modern insulated sliding door with recessed glazing and safety handle. */}
          <path d="M107 107 198 125 198 240 107 222Z" fill="#49677d" />
          <path d="M113 113 191 129 191 234 113 218Z" fill="#eaf1f6" stroke="#fff" />
          <path d="M118 117 145 123 145 221 118 216Z" fill="#d3e0eb" />
          <path d="M151 141 178 147 178 173 151 167Z" fill="#486a83" stroke="#bccedc" strokeWidth="3" />
          <path d="M154 144 175 148 154 162Z" fill="#8ab8d2" opacity=".65" />
          <path d="M179 187v23" stroke="#e89649" strokeWidth="4" strokeLinecap="round" />
          <path d="M110 102 202 120" stroke="#728fa4" strokeWidth="4" strokeLinecap="round" />
          <path d="M113 217 191 233" stroke="#93aabd" strokeWidth="4" />
        </g>
      )}
      {/* Decorative movement is enabled by rental status, not live equipment readings. */}
      <g transform="matrix(1 .2 0 1 210 151)">
        <rect width="39" height="58" rx="4" fill="#324e64" />
        <rect x="3" y="3" width="33" height="52" rx="3" fill="#f0f5f9" />
        {[17, 39].map((y) => <g key={y}>
          <circle cx="19.5" cy={y} r="9" fill="#49677e" />
          <g transform={`translate(19.5 ${y})`}>
            <g className={`freezer-fan ${y === 39 ? "freezer-fan--reverse" : ""}`}>
              {[0, 90, 180, 270].map((angle) => <path key={angle} d="M0 0C-1-3-6-3-6-6C-2-8 2-4 0 0Z" fill="#c8dbe8" transform={`rotate(${angle})`} />)}
            </g>
          </g>
          <circle cx="19.5" cy={y} r="2" fill="#8eb4ce" />
        </g>)}
      </g>
      <g className="freezer-airflow" fill="none" stroke="#69b8d9" strokeWidth="1.5" strokeLinecap="round">
        <path d="M248 180C270 166 269 145 292 134S326 123 342 112" />
        <path d="M248 193C278 178 273 158 297 147S331 135 347 122" />
        <path d="M248 206C284 192 280 171 303 159S338 147 353 134" />
      </g>
      <path d="M268 132 344 91" stroke="#e9f8ff" strokeWidth="2" />
      <path d="M268 240 344 199" stroke="#8ea7ba" strokeWidth="2" />
      <path d="M188 47 329 75M170 56 311 84M151 66 292 94" stroke="#dfebf2" />
      <g transform="translate(373 120)" stroke={freezing ? "#7c91d5" : "#61b9bf"} strokeWidth="2" strokeLinecap="round" opacity=".75">
        <path d="M-12 0h24M-6-10 6 10M6-10-6 10M-8-4-5 0-8 4M8-4 5 0 8 4" />
      </g>
      <circle cx="67" cy="132" r="3" fill="#9bccdb" />
      <circle cx="369" cy="177" r="2" fill="#9bccdb" />
    </svg>
  );
}

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
        <FreezerIllustration type={freezer.type} />
        {rented && <div className="freezer-snow" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} className="freezer-snowflake" style={{
              "--snow-x": `${8 + index * 7.5}%`,
              "--snow-delay": `${-index * 1.3}s`,
              "--snow-duration": `${6 + (index % 4) * 1.2}s`,
              "--snow-size": `${8 + (index % 3) * 3}px`,
            } as CSSProperties}>❄</span>
          ))}
        </div>}
        <span className="freezer-card-scene-label" title="Движение обозначает активную аренду. Фактическая работа оборудования не проверяется.">{rented ? "Анимация аренды · не телеметрия" : "Схематичное изображение"}</span>
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
