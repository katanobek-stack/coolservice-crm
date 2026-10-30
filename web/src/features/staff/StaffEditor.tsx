import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { Button } from '../../shared/ui/Button';
import { Input, Select } from '../../shared/ui/Input';
import { updateDocumentFieldsIfUnchanged, ConcurrentMutationError } from '../../shared/firebase/concurrency';
import type { StaffMember, StaffRole } from '../../shared/types/staff';
import { effectivePermissions, PERMISSION_LABELS, ROLE_LABELS, staffEditPolicy, staffName, staffProfileChanges, staffRole, type StaffFormValues } from './staffLogic';

const descriptions = {
  dashboard_financials: 'Выручка, расходы и финансовые графики на главном экране.',
  reports_amounts: 'Суммы заявок в отчётах и финансовые результаты в разделе персонала.',
  pl_panel: 'Просмотр и работа с разделом доходов и расходов.',
};
const roleDescription: Record<StaffRole, string> = {
  owner: 'Системная роль владельца. Изменить её здесь нельзя.',
  admin: 'Управляет CRM и сотрудниками. Финансовые разделы зависят от разрешений владельца.',
  manager: 'Работает с клиентами, заявками, приёмкой и отчётами.',
  mechanic: 'Выполняет задачи и ведёт работы по назначенным заявкам.',
};

function saveError(error: unknown): string {
  if (error instanceof ConcurrentMutationError) return 'Данные сотрудника уже изменились. Ваши правки остались в форме. Закройте её и откройте заново, чтобы сверить актуальные данные.';
  const code = (error as { code?: string })?.code;
  if (code === 'permission-denied') return 'Недостаточно прав для сохранения. Возможно, ваша роль или роль сотрудника изменилась. Введённые данные остались в форме.';
  if (code === 'unavailable') return 'Нет связи с сервером. Проверьте подключение и повторите сохранение. Введённые данные остались в форме.';
  return 'Не удалось сохранить изменения. Введённые данные остались в форме — попробуйте ещё раз.';
}

export function StaffEditor({ member, actorId, actorRole, onClose, onSaved }: { member: StaffMember; actorId: string; actorRole: StaffRole; onClose(): void; onSaved(): void }) {
  const [values, setValues] = useState<StaffFormValues>(() => ({ name: member.name ?? '', role: staffRole(member), permissions: effectivePermissions(member) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const policy = staffEditPolicy(actorId, actorRole, member);
  const roleChanged = values.role !== staffRole(member);
  const update = (patch: Partial<StaffFormValues>) => { setValues(current => ({ ...current, ...patch })); setReviewed(false); setError(''); };
  const dirty = values.name !== (member.name ?? '') || roleChanged || JSON.stringify(values.permissions) !== JSON.stringify(effectivePermissions(member));
  const close = () => { if (!busy.current && (!dirty || window.confirm('Закрыть без сохранения изменений?'))) onClose(); };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = formRef.current?.closest<HTMLElement>('.crm-modal');
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(modal?.querySelectorAll<HTMLElement>('input:not([disabled]), select:not([disabled]), button:not([disabled])') ?? []);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    modal?.addEventListener('keydown', handleKey);
    formRef.current?.querySelector<HTMLElement>('input,button')?.focus();
    return () => { modal?.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, []);

  async function save() {
    if (busy.current) return;
    let changes: Partial<StaffMember>;
    try { changes = staffProfileChanges(member, values, actorId, actorRole); }
    catch (err) { setError(err instanceof Error ? err.message : 'Проверьте введённые данные.'); return; }
    if (roleChanged && !reviewed) { setReviewed(true); return; }
    if (!Object.keys(changes).length) { onClose(); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      await updateDocumentFieldsIfUnchanged('staff', member, changes);
      onSaved();
    } catch (err) { setError(saveError(err)); }
    finally { busy.current = false; setSaving(false); }
  }

  return <Modal title="Настройки сотрудника" className="staff-editor" onClose={close}>
    <form ref={formRef} role="dialog" aria-modal="true" aria-label={`Настройки сотрудника ${staffName(member)}`} onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="staff-editor-identity"><strong>{staffName(member)}</strong><span>{member.email || 'Email не указан'}</span><small>Email привязан к учётной записи и здесь не изменяется.</small></div>
      <label>Имя сотрудника<Input value={values.name} maxLength={120} required disabled={saving || !policy.name} autoComplete="name" onChange={e => update({ name: e.target.value })} placeholder="Имя и фамилия"/></label>
      <label>Роль в CRM<Select value={values.role} disabled={saving || !policy.role} onChange={e => update({ role: e.target.value as StaffRole })}>{values.role === 'owner' && <option value="owner">Владелец</option>}<option value="admin">Администратор</option><option value="manager">Менеджер</option><option value="mechanic">Механик</option></Select></label>
      <p className="staff-editor-description">{roleDescription[values.role]}{actorId === member.id && ' Собственную роль и разрешения менять нельзя.'}</p>
      {policy.permissions && values.role === 'admin' && <fieldset disabled={saving}><legend>Финансовые разрешения</legend>{(Object.keys(PERMISSION_LABELS) as (keyof typeof PERMISSION_LABELS)[]).map(key => <label key={key} className="staff-permission"><input type="checkbox" checked={values.permissions[key]} onChange={e => update({ permissions: { ...values.permissions, [key]: e.target.checked } })}/><span><strong>{PERMISSION_LABELS[key]}</strong><small>{descriptions[key]}</small></span></label>)}</fieldset>}
      {actorRole === 'owner' && roleChanged && values.role === 'admin' && <p className="staff-notice">После назначения администратором финансовый доступ будет {Object.values(effectivePermissions(member)).every(Boolean) ? 'открыт ко всем трём разделам' : 'применён по сохранённым разрешениям'}. Отдельные разрешения можно изменить после сохранения роли.</p>}
      {reviewed && roleChanged && <div className="staff-notice" role="status"><strong>Проверьте изменение роли</strong><p>{ROLE_LABELS[staffRole(member)]} → {ROLE_LABELS[values.role]}</p><p>Изменение повлияет на доступ сотрудника. Обновление прав может потребовать повторного входа.</p></div>}
      {error && <div className="staff-editor-error" role="alert">{error}</div>}
      <div className="staff-editor-actions"><Button type="button" variant="ghost" disabled={saving} onClick={close}>Отмена</Button><Button type="submit" disabled={saving || !policy.name}>{saving ? 'Сохранение…' : reviewed && roleChanged ? 'Подтвердить и сохранить' : 'Сохранить изменения'}</Button></div>
    </form>
  </Modal>;
}
