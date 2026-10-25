export function canAttachPpzPhotos(role?: string): boolean { return role === "admin" || role === "owner"; }

/** Stable, bounded palette; status remains text-labelled, not colour-only. */
export function employeeTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["blue", "violet", "teal", "amber", "rose", "indigo"][hash % 6];
}

/** Sort the existing snapshot, without extra Firestore queries or excluding legacy docs. */
export function newestPpzTasks<T extends { id: string; createdAt?: { seconds: number; nanoseconds: number } | null }>(tasks: readonly T[]): T[] {
  const timestamp = (task: T) => {
    const time = task.createdAt;
    return time && Number.isFinite(time.seconds) && Number.isFinite(time.nanoseconds) ? time : null;
  };
  return [...tasks].sort((a, b) => {
    const left = timestamp(a), right = timestamp(b);
    if (left && right) {
      const diff = right.seconds - left.seconds || right.nanoseconds - left.nanoseconds;
      if (diff) return diff;
    } else if (left || right) return left ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type PpzStatusFilter = "active" | "all" | "open" | "in_progress" | "done";
interface SearchablePpzTask {
  id: string; title: string; description?: string; assignees: string[];
  status: "open" | "in_progress" | "done"; createdBy?: string; createdByName?: string;
  assigneeNames?: Record<string, string>; createdAt?: { seconds: number; nanoseconds: number } | null;
}
/** Filter an authorized snapshot only; counts describe the same search/employee scope. */
export function selectPpzTasks<T extends SearchablePpzTask>(tasks: readonly T[], filter: { search: string; employee: string; status: PpzStatusFilter }, name: (id: string) => string) {
  const normalize = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const words = normalize(filter.search.trim()).split(/\s+/).filter(Boolean);
  const scope = tasks.filter(task => {
    if (filter.employee && !task.assignees.includes(filter.employee)) return false;
    const text = normalize([task.title, task.description, task.createdByName, task.createdBy ? name(task.createdBy) : "",
      ...task.assignees.flatMap(id => [name(id), task.assigneeNames?.[id]])].filter(Boolean).join(" "));
    return words.every(word => text.includes(word));
  });
  const counts = { all: scope.length, active: 0, open: 0, in_progress: 0, done: 0 };
  for (const task of scope) { counts[task.status]++; if (task.status !== "done") counts.active++; }
  return { counts, tasks: newestPpzTasks(scope.filter(task => filter.status === "all" || (filter.status === "active" ? task.status !== "done" : task.status === filter.status))) };
}

export interface PpzCreateRequest { action: "create"; id: string; requestId: string; title: string; assignees: string[] }
/** Reuse both document and receipt IDs when retrying the same logical creation. */
export function ppzCreateRequest(previous: PpzCreateRequest | null, input: { title: string; assignees: string[] }, newId: () => string): PpzCreateRequest {
  const title = input.title.trim(), assignees = [...new Set(input.assignees)].sort();
  if (previous && previous.title === title && JSON.stringify(previous.assignees) === JSON.stringify(assignees)) return previous;
  return { action: "create", id: newId(), requestId: newId(), title, assignees };
}
