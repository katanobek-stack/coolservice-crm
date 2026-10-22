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
