import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseDb, getFirebaseFunctions } from './app';
import type { MaterialSaveInput, MaterialReceiptInput, MaterialUseInput, MaterialReturnInput, TimeInput, PieceInput, RateInput, ValuationInput, MaterialCountInput, VoidTimeInput, ReworkInput, ReworkDecisionInput, ResourceSnapshot, ResourceTarget } from '../types/resources';

async function call(action: string, input: object): Promise<{id?: string; repairId?: string}> {
  const result=await httpsCallable(getFirebaseFunctions(),'manageRepairResources')({action,...input});
  return result.data as {id?:string;repairId?:string};
}
export const saveMaterial=(input:MaterialSaveInput)=>call('saveMaterial',input);
export const receiveMaterial=(input:MaterialReceiptInput)=>call('receiveMaterial',input);
export const consumeMaterial=(input:MaterialUseInput)=>call('consumeMaterial',input);
export const returnMaterial=(input:MaterialReturnInput)=>call('returnMaterial',input);
export const addRepairTime=(input:TimeInput)=>call('addRepairTime',input);
export const addPieceCharge=(input:PieceInput)=>call('addPieceCharge',input);
export const saveResourceRate=(input:RateInput)=>call('saveResourceRate',input);
export const setMaterialValuation=(input:ValuationInput)=>call('setMaterialValuation',input);
export const countMaterialStock=(input:MaterialCountInput)=>call('countMaterialStock',input);
export const voidRepairTime=(input:VoidTimeInput)=>call('voidRepairTime',input);
export const confirmTaskResources=(input:{requestId:string;target:ResourceTarget;taskId:string})=>call('confirmTaskResources',input);
export const createRepairRework=async(input:ReworkInput)=>await call('createRepairRework',input) as {repairId:string};
export const decideRepairRework=(input:ReworkDecisionInput)=>call('decideRepairRework',input);
export const saveRepairPaymentDestination=(input:{requestId:string;target:ResourceTarget;destination:'cash'|'bank'|'unspecified'})=>call('saveRepairPaymentDestination',input);

const empty:ResourceSnapshot={items:[],entries:[],confirmations:[],reworks:[],valuations:[],rates:[],costs:[],movements:[],ready:false,financialReady:false,error:''};
/** Independent subscriptions; missing/offline data never becomes a zero balance. */
export function useResources(financial:boolean,repairId?:string):ResourceSnapshot {
  const [snapshot,setSnapshot]=useState<ResourceSnapshot>(empty);
  useEffect(()=>{
    let alive=true;const confirmed=new Set<string>(),errors=new Map<string,string>();
    const financialSources=repairId?['resourceCosts']:['materialValuations','resourceRates','resourceCosts','materialMovements'];
    const publicSources=['materialItems','repairResources','repairResourceConfirmations','repairReworks'];
    const names=[...publicSources,...(financial?financialSources:[])];
    const fields:Record<string,keyof ResourceSnapshot>={materialItems:'items',repairResources:'entries',repairResourceConfirmations:'confirmations',repairReworks:'reworks',materialValuations:'valuations',resourceRates:'rates',resourceCosts:'costs',materialMovements:'movements'};
    setSnapshot({...empty});
    function update(field?:string,rows?:unknown[]){if(!alive)return;setSnapshot(previous=>({...previous,...(field?{[field]:rows}:{}),ready:publicSources.every(name=>confirmed.has(name)),financialReady:financial&&financialSources.every(name=>confirmed.has(name)),error:[...errors.values()].join(' ')}));}
    const unsubs=names.map(name=>{
      const source=collection(getFirebaseDb(),name);
      const scoped=repairId&&['repairResources','resourceCosts','repairResourceConfirmations','repairReworks'].includes(name)?query(source,where('repairId','==',repairId)):source;
      return onSnapshot(scoped,{includeMetadataChanges:true},snap=>{
        if(snap.metadata.fromCache||snap.metadata.hasPendingWrites){confirmed.delete(name);update();return;}
        confirmed.add(name);errors.delete(name);
        const rows=snap.docs.map(doc=>{
          const data=doc.data();
          return {...data,id:doc.id,...(data.createdAt?.toDate?{createdAt:data.createdAt.toDate().toISOString()}: {})};
        });
        if(['repairResources','materialMovements'].includes(name))rows.sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??''))||a.id.localeCompare(b.id));
        update(fields[name],rows);
      },()=>{confirmed.delete(name);errors.set(name,'Не удалось загрузить материалы или затраты. Проверьте соединение и права доступа.');update();});
    });
    return()=>{alive=false;unsubs.forEach(unsub=>unsub());};
  },[financial,repairId]);
  return snapshot;
}
