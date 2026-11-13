import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProcurementCatalogItem, ProcurementGroup } from '../../shared/types/procurement';
import { scanCataloguePhotos } from './cataloguePhotos';
import { findSimilarCatalogItems, type PhotoFingerprint } from './catalogueSimilarity';

export function CatalogSimilarityPanel({ items, groups, groupId, busy, compare, onClose }: { items: ProcurementCatalogItem[]; groups: ProcurementGroup[]; groupId: string; busy: boolean; compare: (items: ProcurementCatalogItem[]) => void; onClose: () => void }) {
  const [selectedGroup, setSelectedGroup] = useState(groupId), [photos, setPhotos] = useState<ReadonlyMap<string, PhotoFingerprint>>(new Map()), [progress, setProgress] = useState(0), [scanning, setScanning] = useState(true), [error, setError] = useState(''), [page, setPage] = useState(1), [includeDifferent, setIncludeDifferent] = useState(false);
  const snapshot = useRef({ items, groups });
  const activeGroups = groups.filter(group => group.active), candidates = useMemo(() => findSimilarCatalogItems(items, groups, photos), [items, groups, photos]);
  const filtered = candidates.filter(pair => (!selectedGroup || pair.groupId === selectedGroup) && (includeDifferent || !pair.differentVariants)), visible = filtered.slice((page - 1) * 12, page * 12), pages = Math.max(1, Math.ceil(filtered.length / 12));
  useEffect(() => { setPage(1); }, [selectedGroup, filtered.length]);
  useEffect(() => {
    let cancelled = false;
    const active = new Set(snapshot.current.groups.filter(group => group.active).map(group => group.id));
    const input = snapshot.current.items.filter(item => !item.archived && !item.mergedIntoId && item.groupId && active.has(item.groupId));
    void scanCataloguePhotos(input, done => { if (!cancelled) setProgress(done); }, () => cancelled).then(result => { if (!cancelled) { setPhotos(result); setScanning(false); } }).catch(() => { if (!cancelled) { setScanning(false); setError('Не удалось сравнить часть фотографий. Совпадения по ссылкам и названиям показаны ниже.'); } });
    return () => { cancelled = true; };
  }, []);
  return <section className="materials-panel procurement-similarity-panel">
    <header><div><h2>Похожие товары внутри групп</h2><p>Это кандидаты для сравнения. Одинаковое фото или ссылка не доказывает одинаковый размер, напряжение или комплектацию. Карточки не объединяются автоматически.</p></div><button type="button" className="materials-btn" onClick={onClose}>Закрыть подбор</button></header>
    <div className="materials-filters"><label>Искать в группе<select aria-label="Группа поиска похожих товаров" value={selectedGroup} onChange={event => setSelectedGroup(event.target.value)}><option value="">Все мои группы</option>{activeGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><span className="procurement-caption">Найдено пар: {filtered.length}. «Без группы» и корзина исключены.</span></div>
    <label className="materials-check procurement-include-variants"><input type="checkbox" checked={includeDifferent} onChange={event => setIncludeDifferent(event.target.checked)} />Показать также разные описания модификаций</label><p className="procurement-caption">Сначала показаны совпадения без различий в описании модификации. Явные числовые различия в размерах и характеристиках исключены из подбора.</p>
    {scanning && <p role="status" className="materials-notice">Сравниваем фотографии: {progress} товаров. Совпадения по ссылкам и моделям уже доступны.</p>}{error && <p role="alert" className="materials-notice materials-error">{error}</p>}
    <div className="procurement-similarity-pairs">{visible.map(pair => <article key={pair.key}>
      <header><strong>{groups.find(group => group.id === pair.groupId)?.name}</strong><span>{pair.reasons.join(' · ')}</span></header><div className="procurement-similarity-items">{pair.items.map(item => <div key={item.id}>{item.imageDataUrl ? <img loading="lazy" src={item.imageDataUrl} alt={item.name} /> : <span>Без фото</span>}<strong>{item.name}</strong><p>{item.variant || 'Модификация не указана'}</p></div>)}</div>
      {pair.differentVariants && <p className="procurement-variant-warning">Описание модификаций отличается — проверьте перед объединением.</p>}
      <button type="button" className="materials-btn materials-primary" disabled={busy} onClick={() => compare(pair.items)}>Сравнить и назвать товар</button>
    </article>)}</div>
    {!scanning && !filtered.length && <p className="materials-empty">В этой группе совпадений по доступным данным не найдено. Это не гарантирует отсутствие дублей; при необходимости можно выбрать карточки вручную.</p>}
    {pages > 1 && <div className="procurement-pagination"><button className="materials-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Предыдущие пары</button><span>{page} / {pages}</span><button className="materials-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Следующие пары</button></div>}
  </section>;
}
