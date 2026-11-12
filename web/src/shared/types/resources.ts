export type MaterialUnit = 'pcs' | 'kg' | 'ml' | 'm';
export interface MaterialItem { id: string; name: string; unit: MaterialUnit; quantityMilli: number; minimumMilli: number; active: boolean; revision: number }
export interface MaterialValuation { id: string; valueCents: number | null }
export interface ResourceRate { id: string; hourlyCostCents: number }
export interface ResourceTarget { kind: 'client' | 'intake'; documentId: string; repairId: string }
export interface RepairResource { id: string; repairId: string; taskId: string; type: 'material' | 'return' | 'time' | 'piece'; materialId?: string; materialName?: string; unit?: MaterialUnit; quantityMilli?: number; minutes?: number; staffId?: string; originalId?: string; returnedMilli?: number; voided?: boolean; note: string; createdBy: string; createdAt?: unknown }
export interface ResourceCost { id: string; repairId: string; costCents: number | null; hourlyCostCents?: number }
export interface MaterialMovement { id: string; materialId: string; type: 'receipt' | 'material' | 'return' | 'count'; quantityMilli: number; costCents: number | null; note: string; createdBy: string; createdAt?: unknown; repairId?: string }
export interface ResourceConfirmation { id: string; repairId: string; taskId: string; assigneeIds: string[]; confirmedBy: string; createdAt?: unknown }
export interface ResourceRework { id: string; repairId: string; originalClientId: string; originalRepairId: string; originalTaskId: string; cause: 'pending'|'workmanship'|'part'|'other'; responsibleStaffIds: string[]; decisionNote: string; confirmedBy?: string; confirmedAt?: string }
export interface ResourceSnapshot { items: MaterialItem[]; entries: RepairResource[]; confirmations: ResourceConfirmation[]; reworks: ResourceRework[]; valuations: MaterialValuation[]; rates: ResourceRate[]; costs: ResourceCost[]; movements: MaterialMovement[]; ready: boolean; financialReady: boolean; error: string }
export interface ResourceMutation { requestId: string }
export interface MaterialSaveInput extends ResourceMutation { id: string; name: string; unit: MaterialUnit; minimumMilli: number; expectedRevision?: number; active?: boolean }
export interface MaterialReceiptInput extends ResourceMutation { materialId: string; quantityMilli: number; costCents: number | null; note: string }
export interface MaterialUseInput extends ResourceMutation { target: ResourceTarget; taskId: string; materialId: string; quantityMilli: number; note: string }
export interface MaterialReturnInput extends ResourceMutation { entryId: string; quantityMilli: number; note: string }
export interface TimeInput extends ResourceMutation { target: ResourceTarget; taskId: string; minutes: number; staffId: string; note: string }
export interface PieceInput extends ResourceMutation { target: ResourceTarget; taskId: string; staffId: string; costCents: number; note: string }
export interface RateInput extends ResourceMutation { staffId: string; hourlyCostCents: number }
export interface ValuationInput extends ResourceMutation { materialId: string; expectedRevision: number; valueCents: number }
export interface MaterialCountInput extends ResourceMutation { materialId: string; expectedRevision: number; quantityMilli: number; note: string }
export interface VoidTimeInput extends ResourceMutation { entryId: string; note: string }
export interface ReworkInput extends ResourceMutation { clientId: string; originalRepairId: string; originalTaskId: string; description: string; assignees: string[] }
export interface ReworkDecisionInput extends ResourceMutation { clientId: string; repairId: string; cause: 'pending' | 'workmanship' | 'part' | 'other'; responsibleStaffIds: string[]; note: string; expectedConfirmedAt?: string | null }
