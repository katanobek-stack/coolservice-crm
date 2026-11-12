export interface ProcurementSupplier { url: string; site: string; product: string; priceFen: number | null }
export interface ProcurementSource { file: string; row: number; year: string; quantity: string; priceFen: number | null; description: string }
export interface ProcurementCatalogItem {
  id: string; name: string; variant: string; suppliers: ProcurementSupplier[]; sources: ProcurementSource[];
  imageDataUrl: string; needsReview: boolean; reviewNote: string; linkedMaterialId?: string; revision?: number;
  groupId?: string; archived?: boolean;
}
export interface ProcurementGroup { id: string; name: string; active: boolean; revision: number; position: number }
export interface CatalogMutation { operation: 'move' | 'rename' | 'trash' | 'restore'; items: { id: string; revision: number }[]; groupId?: string; name?: string; variant?: string }
export interface ProcurementOrderLine {
  catalogId: string; name: string; variant: string; supplierUrl: string;
  quantity: string; unitPrice: string; chinaDelivery: string; receivedQuantity: string; weightKg: string;
}
export interface ProcurementOrderDraft {
  id: string; name: string; commission: string; exchange: string; freightRate: string; lines: ProcurementOrderLine[];
}
export interface ProcurementOrder extends ProcurementOrderDraft { revision: number }
export interface ProcurementSettings { commission: string; exchange: string; freightRate: string }
