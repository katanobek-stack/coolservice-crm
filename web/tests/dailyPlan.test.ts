import { test } from "node:test";
import assert from "node:assert/strict";
import { vladivostokDate, resolveTask, sourceKey } from "../src/features/daily-plan/logic";
import { newestPpzTasks } from "../src/features/daily-plan/presentation";

test("PPZ puts newly created tasks first, independently of snapshot IDs and updates", () => {
  const old = { id: "z-old", createdAt: { seconds: 100, nanoseconds: 0 }, updatedAt: 9999 };
  const newer = { id: "a-new", createdAt: { seconds: 200, nanoseconds: 1 }, updatedAt: 200 };
  const newest = { id: "m-newest", createdAt: { seconds: 200, nanoseconds: 2 }, updatedAt: 200 };
  const snapshot = [old, newest, newer];
  assert.deepEqual(newestPpzTasks(snapshot).map(t => t.id), ["m-newest", "a-new", "z-old"]);
  assert.deepEqual(snapshot, [old, newest, newer]);
  assert.equal(newestPpzTasks([...snapshot, { id: "just-created", createdAt: { seconds: 300, nanoseconds: 0 }, updatedAt: 300 }])[0].id, "just-created");
});
test("PPZ retains undated legacy tasks at the bottom and has deterministic ties", () => {
  const snapshot = [{ id: "z", createdAt: null }, { id: "b", createdAt: { seconds: 1, nanoseconds: 0 } }, { id: "legacy" }, { id: "a", createdAt: { seconds: 1, nanoseconds: 0 } }];
  assert.deepEqual(newestPpzTasks(snapshot).map(t => t.id), ["a", "b", "legacy", "z"]);
  assert.deepEqual(newestPpzTasks([...snapshot].reverse()).map(t => t.id), ["a", "b", "legacy", "z"]);
  assert.deepEqual(newestPpzTasks([]), []);
});
test("personal day uses Vladivostok around UTC midnight", () => {
  assert.equal(vladivostokDate(new Date("2026-10-12T14:00:00Z")), "2026-10-13");
  assert.equal(vladivostokDate(new Date("2026-10-12T13:59:59Z")), "2026-10-12");
});
test("deleted or moved sources are unavailable instead of appearing complete", () => {
  assert.equal(resolveTask({ kind: "intake", documentId: "moved", taskId: "a" }, [], [], []), undefined);
  assert.notEqual(sourceKey({ kind: "repair", documentId: "c", repairId: "one", taskId: "a" }), sourceKey({ kind: "repair", documentId: "c", repairId: "two", taskId: "a" }));
});

import * as presentation from "../src/features/daily-plan/presentation";
type Summary = { id: string; title: string; description?: string; assignees: string[]; status: "open" | "in_progress" | "done"; createdBy?: string; createdByName?: string; assigneeNames?: Record<string,string> };
const workspace = presentation as unknown as {
  selectPpzTasks(tasks: Summary[], filter: { search: string; employee: string; status: string }, name: (id: string) => string): { tasks: Summary[]; counts: Record<string,number> };
  ppzCreateRequest(previous: unknown, input: { title: string; assignees: string[] }, newId: () => string): { id: string; requestId: string; title: string; assignees: string[] };
};
const names = (id: string) => ({ a: "Егор", b: "Владимир", owner: "Сергей" }[id] || id);
const assigned: Summary[] = [
  { id: "a", title: "Проверить рефрижератор", description: "Утечка в контуре", assignees: ["a","b"], status: "open", createdBy: "owner" },
  { id: "b", title: "Убрать бокс", assignees: ["b"], status: "in_progress" },
  { id: "c", title: "Проверить рефрижератор", assignees: ["a"], status: "done", createdByName: "Архивный автор" },
];
test("PPZ combines employee/status and multiword search without excluding legacy records", () => {
  assert.equal(typeof workspace.selectPpzTasks, "function");
  assert.deepEqual(workspace.selectPpzTasks(assigned,{ search:"  ЕГОР утечка ",employee:"a",status:"active" },names).tasks.map(t=>t.id),["a"]);
  assert.deepEqual(workspace.selectPpzTasks(assigned,{ search:"архивный",employee:"",status:"done" },names).tasks.map(t=>t.id),["c"]);
  assert.deepEqual(workspace.selectPpzTasks(assigned,{ search:"Сергей",employee:"",status:"all" },names).tasks.map(t=>t.id),["a"]);
  assert.deepEqual(workspace.selectPpzTasks(assigned,{ search:"невозможное",employee:"",status:"all" },names).tasks,[]);
});
test("PPZ scope counts ignore status selection but respect employee and search", () => {
  assert.equal(typeof workspace.selectPpzTasks, "function");
  const result=workspace.selectPpzTasks(assigned,{search:"рефрижератор",employee:"a",status:"done"},names);
  assert.deepEqual(result.counts,{all:2,active:1,open:1,in_progress:0,done:1});
  assert.deepEqual(result.tasks.map(t=>t.id),["c"]);
  assert.equal(assigned.length,3);assert.deepEqual(assigned[0].assignees,["a","b"]);
});
test("PPZ create retry reuses task and receipt IDs after a lost response", () => {
  assert.equal(typeof workspace.ppzCreateRequest, "function");
  let n=0;const id=()=>`request-${++n}`;
  const first=workspace.ppzCreateRequest(null,{title:"  Убрать бокс ",assignees:["b","a","a"]},id);
  const retry=workspace.ppzCreateRequest(first,{title:"Убрать бокс",assignees:["a","b"]},id);
  assert.equal(retry.id,first.id);assert.equal(retry.requestId,first.requestId);assert.equal(n,2);
  assert.equal(retry.title,"Убрать бокс");assert.deepEqual(retry.assignees,["a","b"]);
  const changed=workspace.ppzCreateRequest(retry,{title:"Подготовить бокс",assignees:["a","b"]},id);
  assert.notEqual(changed.id,first.id);assert.notEqual(changed.requestId,first.requestId);
});
