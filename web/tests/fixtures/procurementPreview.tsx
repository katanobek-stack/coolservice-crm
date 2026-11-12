import { createRoot } from 'react-dom/client';
import { MaterialsTab } from '../../src/features/materials/MaterialsTab';
import { setRole } from './procurementPreviewMock';

createRoot(document.getElementById('root')!).render(<><div className="preview-banner"><strong>Локальная примерка склада</strong><span>Каталог из ваших заказов. Изменения здесь не затрагивают рабочую CRM.</span><label>Просмотр от имени <select aria-label="Роль просмотра" onChange={event => setRole(event.target.value)}><option value="owner">Руководителя</option><option value="mechanic">Механика</option><option value="denied">Менеджера без финансов</option></select></label></div><MaterialsTab /></>);
