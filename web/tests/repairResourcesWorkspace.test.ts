import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseResourceQuantity, parseResourceMinutes, returnableQuantity} from '../src/shared/repair-work/resourceFormLogic';

test('manual quantities accept decimal comma and preserve thousandths without rounding',()=>{
 assert.equal(parseResourceQuantity('1,025'),1025);
 assert.equal(parseResourceQuantity(' 2.5 '),2500);
 for(const value of ['','0','-1','1.0001','1e2','1.2kg','Infinity','9007199254740991'])assert.equal(parseResourceQuantity(value),null,value);
});
test('time is positive whole minutes and returns are bounded by unused consumption',()=>{
 assert.equal(parseResourceMinutes('45'),45);
 for(const value of ['0','1.5','-2','2m',''])assert.equal(parseResourceMinutes(value),null);
 assert.equal(returnableQuantity({quantityMilli:2500,returnedMilli:1000}),1500);
 assert.equal(returnableQuantity({quantityMilli:1000,returnedMilli:2000}),0);
});

test('submission retries retain their request identity until acknowledged by the server',async()=>{
 const {createResourceRequestRegistry}=await import('../src/shared/repair-work/resourceFormLogic');
 let serial=0;const requests=createResourceRequestRegistry(()=>`request-${++serial}`);
 const payload={target:{repairId:'repair'},minutes:30};
 assert.equal(requests.get('time',payload),'request-1');
 assert.equal(requests.get('time',{...payload}),'request-1');
 assert.equal(requests.get('time',{...payload,minutes:45}),'request-2');
 requests.complete('time',payload);
 assert.equal(requests.get('time',payload),'request-3');
});

test('resource confirmation matches the current assignees and requires explicit labor declarations',async()=>{
 const {resourceAccountingState}=await import('../src/shared/repair-work/resourceFormLogic');
 const task={id:'t',assignees:['a','b']};
 const entries=[{type:'time',taskId:'t',staffId:'a',minutes:0,note:'No work needed'},{type:'time',taskId:'t',staffId:'b',minutes:30}];
 assert.deepEqual(resourceAccountingState(task,entries,[]),{canConfirm:true,confirmed:false});
 assert.equal(resourceAccountingState(task,entries,[{taskId:'t',assigneeIds:['b','a']}]).confirmed,true);
 assert.equal(resourceAccountingState({...task,assignees:['a','b','c']},entries,[{taskId:'t',assigneeIds:['b','a']}]).confirmed,false);
 assert.equal(resourceAccountingState(task,[{...entries[0],voided:true}],[]).canConfirm,false);
});
test('zero time requires a deliberate choice and a reason',async()=>{
 const {manualTimeMinutes}=await import('../src/shared/repair-work/resourceFormLogic');
 assert.equal(manualTimeMinutes('',true,'No work needed'),0);
 assert.equal(manualTimeMinutes('',true,''),null);
 assert.equal(manualTimeMinutes('0',false,'reason'),null);
 assert.equal(manualTimeMinutes('30',false,''),30);
});
