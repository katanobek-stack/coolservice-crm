export interface PlanSource {
  kind: "service" | "repair" | "intake";
  documentId: string;
  taskId?: string;
  repairId?: string;
}
export interface PlanItem {
  id: string;
  source: PlanSource;
  title: string;
  order: number;
  priority: "normal" | "high";
  deadline: string;
  note: string;
  newService?: boolean;
}
export interface DailyPlan {
  createdBy?: string; createdByName?: string; createdAt?: { toDate(): Date };
  staffName?: string; publishedBy?: string; publishedByName?: string; publishedAt?: { toDate(): Date };
  staffId: string;
  date: string;
  revision: number;
  version: number;
  status: "draft" | "published";
  hasDraft: boolean;
  deliveryStatus?: "pending" | "sent" | "unknown" | "failed";
}
