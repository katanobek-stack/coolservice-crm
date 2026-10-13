import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./app";
import type { PlanItem } from "../types/dailyPlan";

export async function saveDailyPlan(staffId: string, date: string, revision: number, items: PlanItem[]) {
  return (await httpsCallable<unknown, { revision: number }>(getFirebaseFunctions(), "saveDailyPlan")({ staffId, date, revision, items })).data;
}
export async function publishDailyPlan(staffId: string, date: string, revision: number) {
  return (await httpsCallable<unknown, { revision: number; version: number }>(getFirebaseFunctions(), "publishDailyPlan")({ staffId, date, revision })).data;
}
export async function updateDailyPlanWork(planId: string, itemId: string, done: boolean | undefined, comment: string) {
  await httpsCallable(getFirebaseFunctions(), "updateDailyPlanWork")({ planId, itemId, ...(done === undefined ? {} : { done }), comment });
}
export async function retryDailyPlanNotification(planId: string) {
  await httpsCallable(getFirebaseFunctions(), "retryDailyPlanNotification")({ planId });
}
