import { useMemo, useState } from 'react';
import { useData } from '../../shared/context/DataContext';
import { useAuth } from '../auth';
import { usePermissions } from '../../shared/hooks/usePermissions';
import type { StaffMember } from '../../shared/types/staff';
import type { SourceStatus } from '../../shared/context/dataReadiness';
import { buildStaffResults, staffMonth, staffRole } from './staffLogic';
import { StaffWorkspace } from './StaffWorkspace';
import { StaffEditor } from './StaffEditor';

function combinedStatus(...statuses: SourceStatus[]): SourceStatus {
  return statuses.includes('error') ? 'error' : statuses.includes('loading') ? 'loading' : 'ready';
}

export function StaffTab() {
  const { staff, clients, intakeRepairs, sourceStatus } = useData();
  const { user, myProfile, isOwner } = useAuth();
  const { canSeeReportsAmounts } = usePermissions();
  const [month, setMonth] = useState(staffMonth);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [message, setMessage] = useState('');
  const role = isOwner ? 'owner' : staffRole(myProfile ?? { id: '' });
  const rows = useMemo(() => buildStaffResults(staff, clients, intakeRepairs, month), [staff, clients, intakeRepairs, month]);

  if (!user || !['owner', 'admin'].includes(role)) return <div className="staff-empty">Раздел персонала доступен владельцу и администратору.</div>;

  return <>
    {message && <div className="staff-notice" role="status" style={{ marginBottom: 16 }}>{message} <button type="button" onClick={() => setMessage('')} aria-label="Закрыть уведомление" style={{ float: 'right', background: 'transparent', border: 0, cursor: 'pointer' }}>×</button></div>}
    <StaffWorkspace rows={rows} staffStatus={sourceStatus.staff} resultsStatus={sourceStatus.clients} workStatus={combinedStatus(sourceStatus.clients, sourceStatus.intakeRepairs)} month={month} onMonthChange={setMonth} actorId={user.uid} actorRole={role} showAmounts={role === 'owner' || canSeeReportsAmounts} onEdit={member => { setMessage(''); setEditing(member); }}/>
    {editing && <StaffEditor key={editing.id} member={editing} actorId={user.uid} actorRole={role} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMessage('Изменения сотрудника сохранены.'); }}/>}
  </>;
}
