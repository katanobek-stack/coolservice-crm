export interface ServiceTask {
  id: string;
  title?: string;
  description?: string;
  taskType?: string;
  assignees: string[];
  doneBy: string[];
  status?: "in_progress" | "done";
  workComment?: string;
  photos?: Array<{ id: string; url: string; path: string }>;
  createdAt?: unknown;
}
