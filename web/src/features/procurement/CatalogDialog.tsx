import { useState, type FormEvent } from 'react';
import { Modal } from '../../shared/ui/Modal';

export interface CatalogDialogSpec {
  title: string; name?: string; variant?: string; message?: string; submit: string;
  save: (name: string, variant: string) => Promise<void>;
}
export function CatalogDialog({ spec, onClose }: { spec: CatalogDialogSpec; onClose: () => void }) {
  const [name, setName] = useState(spec.name ?? ''), [variant, setVariant] = useState(spec.variant ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await spec.save(name.trim(), variant.trim()); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить изменения'); }
    finally { setBusy(false); }
  }
  return <Modal className="procurement-dialog" title={spec.title} onClose={() => { if (!busy) onClose(); }}>
    <form className="materials-form" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} className="procurement-fieldset">
        {spec.message && <p className="materials-help">{spec.message}</p>}
        {spec.name !== undefined && <label>Название<input autoFocus required maxLength={spec.variant === undefined ? 80 : 160} value={name} onChange={event => setName(event.target.value)} /></label>}
        {spec.variant !== undefined && <label>Модификация<textarea maxLength={1000} rows={3} value={variant} onChange={event => setVariant(event.target.value)} /></label>}
        {error && <p role="alert" className="materials-notice materials-error">{error}</p>}
        <div className="materials-form-footer"><button type="button" className="materials-btn" onClick={onClose}>Отмена</button><button className="materials-btn materials-primary" type="submit">{busy ? 'Сохраняем…' : spec.submit}</button></div>
      </fieldset>
    </form>
  </Modal>;
}
