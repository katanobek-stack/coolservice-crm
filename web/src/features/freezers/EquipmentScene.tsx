import { useId, useState } from "react";
import "./equipmentScene.css";

interface FanRegistration {
  x: number;
  y: number;
  radius: number;
  scaleX: number;
  shearY: number;
}
interface Artwork {
  asset: string;
  kind: string;
  label: string;
  fans: readonly FanRegistration[];
  airflow: string;
}

// Registration uses the original 1536 × 1024 render coordinates. Both the
// image and overlay keep precisely the same aspect ratio at every card size.
const ARTWORK: Record<string, Artwork> = {
  coldroom: {
    asset: "coldroom.webp", kind: "coldroom", label: "Панельная камера",
    fans: [{ x: 911, y: 545, radius: 145, scaleX: .91, shearY: -.025 }],
    airflow: "M1005 540C1115 530 1155 450 1290 445M1005 572C1135 576 1175 500 1310 505",
  },
  deepfreeze: {
    asset: "deepfreeze.webp", kind: "deepfreeze", label: "Морозильный модуль",
    fans: [{ x: 736, y: 313, radius: 103, scaleX: .84, shearY: -.025 }, { x: 928, y: 305, radius: 108, scaleX: .89, shearY: -.025 }],
    airflow: "M1027 315C1110 295 1180 235 1300 245M1027 341C1140 340 1195 290 1320 298",
  },
  container: {
    asset: "container.webp", kind: "container", label: "Рефрижераторный контейнер",
    fans: [{ x: 259, y: 370, radius: 96, scaleX: .79, shearY: .10 }, { x: 446, y: 391, radius: 101, scaleX: .82, shearY: .10 }],
    airflow: "M194 368C130 350 95 315 45 310M194 395C124 395 90 365 35 365",
  },
  cabinet: {
    asset: "cabinet.webp", kind: "cabinet", label: "Холодильная витрина", fans: [],
    airflow: "M545 740C525 610 525 370 545 200M875 740C855 610 855 370 875 200",
  },
};

export function equipmentArtwork(type?: string): Artwork {
  if (type === "Морозильная камера") return ARTWORK.deepfreeze;
  if (type === "Рефрижераторный контейнер") return ARTWORK.container;
  if (type === "Витрина") return ARTWORK.cabinet;
  return ARTWORK.coldroom;
}

function Fan({ fan, id, index }: { fan: FanRegistration; id: string; index: number }) {
  const clip = `${id}-fan-${index}`;
  return <g transform={`matrix(${fan.scaleX} ${fan.shearY} 0 1 ${fan.x} ${fan.y})`}>
    <defs><clipPath id={clip}><circle r={fan.radius} /></clipPath></defs>
    <g clipPath={`url(#${clip})`}>
      <circle r={fan.radius} fill="#101b25" />
      <circle r={fan.radius - 3} fill={`url(#${id}-well)`} />
      <g transform={`scale(${fan.radius / 145})`}>
        {/* Only this inner rotor moves; perspective and guard stay fixed. */}
        <g className={`equipment-rotor equipment-rotor--${index % 2}`}>
          {[0, 72, 144, 216, 288].map(angle => <path key={angle} transform={`rotate(${angle})`} d="M-10-19C-45-31-99-30-115-73C-93-115-45-114-25-89C-8-65 5-35-10-19Z" fill={`url(#${id}-blade)`} stroke="#8c9ba5" strokeWidth="1" />)}
        </g>
      </g>
      <g className="equipment-fan-guard" fill="none" stroke="#95a4ac" strokeWidth="1.4" opacity=".68">
        {[.25, .34, .43, .52, .61, .7, .79, .88, .97].map(ratio => <circle key={ratio} r={fan.radius * ratio} />)}
        {[0, 60, 120].map(angle => <path key={angle} transform={`rotate(${angle})`} d={`M-${fan.radius} 0H${fan.radius}`} stroke="#566976" strokeWidth="5" />)}
      </g>
      <circle r={fan.radius * .18} fill={`url(#${id}-hub)`} stroke="#8fa0aa" strokeWidth="2" />
      <circle cx={-fan.radius * .07} cy={-fan.radius * .07} r="2.5" fill="#d3e0e7" />
    </g>
    <circle r={fan.radius} fill="none" stroke="#1b2933" strokeWidth="4" />
  </g>;
}

/** Category artwork, not a model or live reading of the actual equipment. */
export function EquipmentScene({ type }: { type?: string }) {
  const art = equipmentArtwork(type);
  const id = `equipment-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const base = import.meta.env?.BASE_URL ?? "/";
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={`equipment-scene equipment-scene--${art.kind} freezer-illustration`} aria-hidden="true" data-artwork={art.kind}>
    <div className="equipment-scene-caption"><span className="equipment-scene-mark" /><span>{art.label}</span></div>
    <div className="equipment-rig" data-ready={ready} data-failed={failed}>
      <img className="equipment-render" src={`${base}warehouse/${art.asset}`} alt="" width="1200" height="800" loading="lazy" decoding="async" onLoad={() => { setReady(true); setFailed(false); }} onError={() => { setReady(false); setFailed(true); }} />
      {failed && <span className="equipment-image-fallback">Иллюстрация недоступна</span>}
      <svg className="equipment-mechanics" viewBox="0 0 1536 1024" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-well`}><stop stopColor="#172632" /><stop offset=".85" stopColor="#101b25" /><stop offset="1" stopColor="#070f16" /></radialGradient>
          <linearGradient id={`${id}-blade`} x1="-120" y1="-120" x2="10" y2="10" gradientUnits="userSpaceOnUse"><stop stopColor="#a8b8c2" /><stop offset=".3" stopColor="#6f838f" /><stop offset=".7" stopColor="#253d4b" /><stop offset="1" stopColor="#738a98" /></linearGradient>
          <linearGradient id={`${id}-hub`} x1="-25" y1="-25" x2="25" y2="25" gradientUnits="userSpaceOnUse"><stop stopColor="#7e929f" /><stop offset="1" stopColor="#354957" /></linearGradient>
        </defs>
        {art.fans.map((fan, index) => <Fan key={index} fan={fan} id={id} index={index} />)}
        <g className="equipment-airflow" stroke="#65b7d7" strokeWidth="4" strokeLinecap="round"><path d={art.airflow} /></g>
        {art.kind === "cabinet" && <path className="equipment-cabinet-light" d="M475 137 630 125M719 113 929 94" stroke="#d3f3ff" strokeWidth="6" strokeLinecap="round" />}
      </svg>
    </div>
    <div className="equipment-scene-baseline"><span /><i /><span /></div>
  </div>;
}
