import {useState} from 'react';
import {useAuth} from '../auth';
import {saveRepairPaymentDestination} from '../../shared/firebase/resources';
import type {ResourceTarget} from '../../shared/types/resources';
import type {Repair} from '../../shared/types/client';
import {useResourceSubmission} from '../../shared/repair-work/useResourceSubmission';
import {Select} from '../../shared/ui/Input';
import {Button} from '../../shared/ui/Button';
import {repairFinancialDay} from '../../shared/utils/repair';
import {fmtDate} from '../../shared/utils/format';
export function PaymentDestinationPanel({target,repair}:{target:ResourceTarget;repair:Repair}){
 const {myProfile}=useAuth();const manager=['owner','admin','manager'].includes(myProfile?.role??'');
 const [destination,setDestination]=useState(repair.paymentDestination??'unspecified');
 const {busy,error,submit}=useResourceSubmission();
 if(!manager)return null;
 return <div style={{display:'grid',gap:8,margin:'10px 0'}}><fieldset disabled={busy} style={{border:0,padding:0,display:'grid',gap:8}}>
 <label>Куда поступит оплата<Select aria-label="Назначение оплаты" value={destination} onChange={event=>setDestination(event.target.value as typeof destination)}><option value="unspecified">Не указано</option><option value="cash">Касса</option><option value="bank">Банк</option></Select></label>
 <Button size="sm" variant="ghost" onClick={()=>void submit('payment-destination',{target,destination},saveRepairPaymentDestination)}>Сохранить назначение</Button>
 <span>Назначение оплаты — пометка для учёта. Движение денег не создаётся.</span>
 {(repair.workCompletedAt||repair.closedAt)&&<span>Дата учёта выполненных работ: {fmtDate(repairFinancialDay(repair))}</span>}
 </fieldset>{busy&&<p role="status">Сохраняем…</p>}{error&&<p role="alert">{error}</p>}</div>;
}
