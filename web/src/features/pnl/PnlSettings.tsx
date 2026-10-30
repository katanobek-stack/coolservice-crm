import { useRef, useState } from 'react';
import { saveFinanceConfiguration } from '../../shared/firebase/concurrency';
import { genId } from '../../shared/utils/format';
import { parsePnlAmount, type PnlFinance } from './pnlLogic';
import { PnlFeedback, pnlError } from './PnlWorkspace';
type Row = {
    id: string;
    name: string;
    amount: string;
};
export function PnlSettings({ finance, rentalIncome, blocked, onClose }: {
    finance: PnlFinance;
    rentalIncome: number;
    blocked: boolean;
    onClose: () => void;
}) {
    const [baseline] = useState(finance);
    const [boxes, setBoxes] = useState<Row[]>(() => (finance.boxes ?? []).map(b => ({ id: b.id, name: b.name, amount: String(b.cost ?? 0) })));
    const [salaries, setSalaries] = useState<Row[]>(() => (finance.salaries ?? []).map(s => ({ id: s.uid, name: s.name, amount: String(s.salary ?? 0) })));
    const [kwPrice, setKwPrice] = useState(String(finance.kwPrice ?? 0));
    const [error, setError] = useState(''), [saved, setSaved] = useState(''), [busy, setBusy] = useState(false);
    const lock = useRef(false);
    function update(kind: 'boxes' | 'salaries', index: number, field: 'name' | 'amount', value: string) { const set = kind === 'boxes' ? setBoxes : setSalaries; set(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r)); setSaved(''); }
    async function save() {
        if (blocked || lock.current)
            return;
        setError('');
        setSaved('');
        const all = [...boxes, ...salaries];
        if (all.some(r => parsePnlAmount(r.amount) === null || !r.name.trim()) || parsePnlAmount(kwPrice) === null) {
            setError('Укажите название каждой строки и сумму от 0 с точностью до копеек. Пустую строку можно убрать.');
            return;
        }
        lock.current = true;
        setBusy(true);
        try {
            await saveFinanceConfiguration({ boxes: baseline.boxes, salaries: baseline.salaries, kwPrice: baseline.kwPrice }, { boxes: boxes.map(r => ({ id: r.id, name: r.name.trim(), cost: parsePnlAmount(r.amount)! })), salaries: salaries.map(r => ({ uid: r.id, name: r.name.trim(), salary: parsePnlAmount(r.amount)! })), kwPrice: parsePnlAmount(kwPrice)! }, rentalIncome);
            setSaved('Настройки сохранены. Закройте редактор, чтобы увидеть обновлённые значения.');
        }
        catch (e) {
            setError(pnlError(e));
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return <form className="pnl-settings" onSubmit={e => { e.preventDefault(); void save(); }}><div className="pnl-notice">Эти настройки действуют для текущего и будущих месяцев. Сохранённые итоги прошлых периодов не переписываются. Счёт за электричество вводится отдельно в рублях; тариф сам по себе его не начисляет.</div><fieldset disabled={busy || blocked || !!saved}>
 {(['boxes', 'salaries'] as const).map(kind => <section key={kind}><h3>{kind === 'boxes' ? 'Аренда боксов' : 'Зарплаты и услуги'}</h3><p>Плановая постоянная сумма в месяц</p>{(kind === 'boxes' ? boxes : salaries).map((r, i) => <div className="pnl-setting-row" key={r.id}><label>Название<input value={r.name} onChange={e => update(kind, i, 'name', e.target.value)} aria-label={`${kind === 'boxes' ? 'Бокс' : 'Зарплата'} ${i + 1}: название`}/></label><label>Сумма, ₽ / месяц<input inputMode="decimal" value={r.amount} onChange={e => update(kind, i, 'amount', e.target.value)} aria-label={`${kind === 'boxes' ? 'Бокс' : 'Зарплата'} ${i + 1}: сумма`}/></label><button type="button" className="pnl-btn pnl-danger" onClick={() => { (kind === 'boxes' ? setBoxes : setSalaries)(rows => rows.filter((_, j) => j !== i)); setSaved(''); }} aria-label={`Убрать строку ${r.name || i + 1}`}>Убрать</button></div>)}<button type="button" className="pnl-btn" onClick={() => (kind === 'boxes' ? setBoxes : setSalaries)(rows => [...rows, { id: genId(), name: '', amount: '0' }])}>{kind === 'boxes' ? 'Добавить бокс' : 'Добавить зарплату / услугу'}</button></section>)}
 <label className="pnl-tariff">Тариф электричества, ₽ / кВт·ч<input inputMode="decimal" value={kwPrice} onChange={e => { setKwPrice(e.target.value); setSaved(''); }}/></label></fieldset><PnlFeedback error={error} success={saved}/><div className="pnl-form-actions"><button className="pnl-btn pnl-primary" disabled={busy || blocked || !!saved}>{busy ? 'Сохраняем…' : 'Сохранить текущие настройки'}</button><button className="pnl-btn" type="button" onClick={onClose} disabled={busy}>{saved ? 'Закрыть редактор' : 'Отменить изменения'}</button></div></form>;
}
