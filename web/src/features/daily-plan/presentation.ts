/** Stable, bounded palette; status remains text-labelled, not colour-only. */
export function employeeTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["blue", "violet", "teal", "amber", "rose", "indigo"][hash % 6];
}
