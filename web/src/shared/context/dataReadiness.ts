export const DATA_SOURCES = ["clients", "staff", "tasks", "freezers", "finance", "expenses", "appointments", "intakeRepairs"] as const;
export type DataSource = typeof DATA_SOURCES[number];
export type SourceStatus = "loading" | "ready" | "error";
export type DataStatus = Record<DataSource, SourceStatus>;
export function initialDataStatus(): DataStatus {
  return Object.fromEntries(DATA_SOURCES.map(source=>[source,"loading"])) as DataStatus;
}
export function markDataStatus(state: DataStatus, source: DataSource, status: SourceStatus): DataStatus {
  return state[source] === status ? state : {...state,[source]:status};
}
export function sourcesReady(state: DataStatus, sources: readonly DataSource[]): boolean {
  return sources.every(source=>state[source]==="ready");
}
