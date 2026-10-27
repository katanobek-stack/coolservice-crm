import type {Repair} from '../types/client';
import {assertFieldsUnchanged,ConcurrentMutationError} from './concurrency';
import {closureIssue,parseClosureAmount} from '../utils/repairClosure';
/** Called inside the existing transaction, against the freshly read repair. */
export function prepareRepairClose(current:Repair,expected:Repair,sum:string,closedAt:string,uid:string):Repair{
 assertFieldsUnchanged(current,expected,['cost','status','closedByManager','closedAt','tasks','freonType','freonAmount','vehicleId','chamberId','description','date'],'Ремонт');
 const issue=closureIssue(current);if(issue)throw new ConcurrentMutationError(issue);
 const cost=parseClosureAmount(sum);if(cost===null)throw new Error('Укажите корректную сумму: 0 или больше, не более двух знаков после запятой.');
 return {...current,cost,status:'done',closedByManager:true,closedAt,editedBy:uid,editedAt:closedAt};
}
/** Captured when entering review, never replaced by later listener props. */
export function createRepairReview(repair:Repair,sum:string):{repair:Repair;amount:string}{
 const issue=closureIssue(repair);if(issue)throw new Error(issue);
 const amount=parseClosureAmount(sum);if(amount===null)throw new Error('Укажите корректную сумму: 0 или больше, не более двух знаков после запятой.');
 return {repair,amount};
}
