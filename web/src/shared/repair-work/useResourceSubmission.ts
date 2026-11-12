import {useRef,useState} from 'react';
import {genId} from '../utils/format';
import {createResourceRequestRegistry} from './resourceFormLogic';
/** A retry of the same payload keeps its server idempotency key. */
export function useResourceSubmission(){
 const requests=useRef(createResourceRequestRegistry(genId));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 async function submit<T extends object>(operation:string,payload:T,save:(input:T&{requestId:string})=>Promise<unknown>,done?:()=>void){
  if(inFlight.current)return;
  const requestId=requests.current.get(operation,payload);
  inFlight.current=true;setBusy(true);setError('');
  try{await save({...payload,requestId});requests.current.complete(operation,payload);done?.();}
  catch(reason){setError(reason instanceof Error?reason.message:'Не удалось сохранить. Повторите попытку.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return {busy,error,setError,submit};
}
