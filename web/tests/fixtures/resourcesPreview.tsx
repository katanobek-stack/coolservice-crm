import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ResourcePanel} from '../../src/shared/repair-work/ResourcePanel';
import {ReworkPanel} from '../../src/features/done/ReworkPanel';
import {PaymentDestinationPanel} from '../../src/features/done/PaymentDestinationPanel';
import {MaterialsTab} from '../../src/features/materials/MaterialsTab';
import {original,child,task,setRole} from './resourcesPreviewMock';
function Preview(){const [view,setView]=useState('resource');return <main><h1>Материалы, время и переделки</h1><label>Роль <select aria-label="Роль" onChange={event=>setRole(event.target.value)}><option value="owner">Руководитель</option><option value="mechanic">Механик</option><option value="denied">Менеджер без финансов</option></select></label><nav>{[['resource','Работа'],['original','Исходный ремонт'],['rework','Переделка'],['intake','Приёмка'],['materials','Материалы']].map(([id,label])=><button key={id} onClick={()=>setView(id)}>{label}</button>)}</nav>{view==='resource'&&<ResourcePanel target={{kind:'client',documentId:'client',repairId:'original'}} taskId="task" task={task}/>} {view==='original'&&<ReworkPanel clientId="client" repair={original}/>} {view==='rework'&&<ReworkPanel clientId="client" repair={child}/>} {view==='intake'&&<PaymentDestinationPanel target={{kind:'intake',documentId:'intake',repairId:'intakeRepair'}} repair={original}/>} {view==='materials'&&<MaterialsTab/>}</main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
