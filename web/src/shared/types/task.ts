import type { PhotoData } from "../utils/photos";

export interface Subtask {
  id:          string;
  description: string;
  assignees:   string[];
  doneBy:      string[];
  status:      "in_progress" | "done";
  workComment: string;
  photos?:     PhotoData[];
}

export interface ServiceTask {
  id:          string;
  title?:      string;
  description?: string;
  taskType?:   "task" | "project";
  assignees:   string[];
  doneBy:      string[];
  status?:     "in_progress" | "done";
  workComment?: string;
  photos?:     PhotoData[];
  subtasks?:   Subtask[];
  createdAt?:  unknown;
}
