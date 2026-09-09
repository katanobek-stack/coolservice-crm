import type { Repair, RepairTask } from "../types/client";
import {
  addRepairTask,
  mutateClientRepair,
  mutateRepairTask,
  removeRepairTask,
} from "../firebase/concurrency";
import {
  addIntakeRepairTask,
  mutateIntakeRepairEmbedded,
  mutateIntakeRepairTask,
  removeIntakeRepairTask,
} from "../firebase/intake";

/**
 * Everything the shared repair-work UI needs to persist a change, regardless of
 * where the repair lives — inside a client document or in an intake document.
 * Every `fn` receives a freshly-read copy from the transaction.
 */
export interface RepairEditor {
  mutateRepair(fn: (repair: Repair) => Repair): Promise<void>;
  mutateTask(task: RepairTask, fn: (task: RepairTask) => RepairTask): Promise<void>;
  addTask(task: RepairTask): Promise<void>;
  removeTask(task: RepairTask): Promise<void>;
}

/** Editor for a repair stored in `clients/{clientId}.repairs[]`. */
export function clientRepairEditor(clientId: string, repair: Repair): RepairEditor {
  return {
    mutateRepair: (fn) => mutateClientRepair(clientId, repair, fn),
    mutateTask: (task, fn) => mutateRepairTask(clientId, repair, task, fn),
    addTask: (task) => addRepairTask(clientId, repair, task),
    removeTask: (task) => removeRepairTask(clientId, repair, task),
  };
}

/** Editor for the repair embedded in an `intakeRepairs/{id}` document. */
export function intakeRepairEditor(
  intakeId: string,
  editor: { uid: string; name: string },
): RepairEditor {
  return {
    mutateRepair: (fn) => mutateIntakeRepairEmbedded(intakeId, fn, editor),
    mutateTask: (task, fn) => mutateIntakeRepairTask(intakeId, task, fn, editor),
    addTask: (task) => addIntakeRepairTask(intakeId, task, editor),
    removeTask: (task) => removeIntakeRepairTask(intakeId, task, editor),
  };
}
