/** Parse catalog units exactly; never round away an entered fraction. */
export function parseResourceQuantity(value: string): number | null {
 const text=value.trim().replace(',', '.');
 if(!/^\d+(?:\.\d{1,3})?$/.test(text))return null;
 const [whole,fraction='']=text.split('.');
 const quantity=Number(whole)*1000+Number(fraction.padEnd(3,'0'));
 return Number.isSafeInteger(quantity)&&quantity>0?quantity:null;
}
export function parseResourceMinutes(value:string):number|null{
 if(!/^\d+$/.test(value.trim()))return null;
 const minutes=Number(value);
 return Number.isSafeInteger(minutes)&&minutes>0?minutes:null;
}
export function returnableQuantity(entry:{quantityMilli?:number;returnedMilli?:number}):number{
 return Math.max(0,(entry.quantityMilli??0)-(entry.returnedMilli??0));
}

/** Keep the same id for an unacknowledged payload, including after network failure. */
export function createResourceRequestRegistry(makeId:()=>string){
 const requests=new Map<string,string>();
 const key=(operation:string,payload:object)=>JSON.stringify([operation,payload]);
 return {
  get(operation:string,payload:object):string{
   const entryKey=key(operation,payload);
   const id=requests.get(entryKey)??makeId();requests.set(entryKey,id);return id;
  },
  complete(operation:string,payload:object){requests.delete(key(operation,payload));},
 };
}

export function manualTimeMinutes(value:string,zeroDeclared:boolean,note:string):number|null{
 return zeroDeclared?(note.trim()?0:null):parseResourceMinutes(value);
}
export function resourceAccountingState(
 task:{id:string;assignees?:string[]},
 entries:{type:string;taskId:string;staffId?:string;voided?:boolean}[],
 confirmations:{taskId:string;assigneeIds:string[]}[],
){
 const assignees=[...new Set(task.assignees??[])].sort();
 const canConfirm=assignees.length>0&&assignees.every(id=>entries.some(entry=>entry.taskId===task.id&&!entry.voided&&entry.staffId===id&&(entry.type==='time'||entry.type==='piece')));
 const confirmed=canConfirm&&confirmations.some(item=>item.taskId===task.id&&JSON.stringify([...new Set(item.assigneeIds)].sort())===JSON.stringify(assignees));
 return {canConfirm,confirmed};
}
