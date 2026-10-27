import type {Repair} from '../types/client';
import {requestStage} from '../requests/workspaceLogic';
/** Preserve zero-cost work; reject partial parses, exponent notation and unsafe cents. */
export function parseClosureAmount(value:string):string|null{
 const normal=value.trim().replace(/\s/g,'').replace(',','.');
 if(!/^\d+(?:\.\d{1,2})?$/.test(normal))return null;
 const amount=Number(normal);return Number.isFinite(amount)&&Number.isSafeInteger(Math.round(amount*100))?normal:null;
}
export function closureIssue(repair:Repair):string|null{
 const stage=requestStage(repair);
 if(stage==='closed')return 'Заявка уже закрыта. Обновите список.';
 if(stage==='cancelled')return 'Заявка отмечена как отказ.';
 if(stage!=='ready')return 'Не все работы выполнены. Проверьте задачи.';
 if((Number.parseFloat(repair.freonAmount||'0')>0&&!repair.freonType?.trim())||(repair.tasks??[]).some(t=>t.freonTask&&Number.parseFloat(t.freonKg||'0')>0&&!t.freonType?.trim()))return 'Укажите марку использованного фреона перед закрытием.';
 return null;
}
