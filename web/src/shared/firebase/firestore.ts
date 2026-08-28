import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getFirebaseDb } from "./app";
import type { Client } from "../types/client";
import type { ServiceTask } from "../types/task";
import type { Freezer } from "../types/freezer";
import type { StaffProfileInput } from "../types/staff";

// ─── Clients ───────────────────────────────────────────────────────────────
export function addClient(data: Omit<Client, "id" | "createdAt">) {
  return addDoc(collection(getFirebaseDb(), "clients"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

// ─── Service Tasks ─────────────────────────────────────────────────────────
export function addServiceTask(data: Omit<ServiceTask, "id" | "createdAt">) {
  return addDoc(collection(getFirebaseDb(), "servicetasks"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

// ─── Freezers ──────────────────────────────────────────────────────────────
export function addFreezer(data: Omit<Freezer, "id" | "createdAt">) {
  return addDoc(collection(getFirebaseDb(), "freezers"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

// ─── Finance ───────────────────────────────────────────────────────────────
// ─── Staff ─────────────────────────────────────────────────────────────────
export function saveStaffProfile(uid: string, data: StaffProfileInput) {
  return setDoc(doc(getFirebaseDb(), "staff", uid), data, { merge: true });
}

export function saveStaffPermissions(uid: string, permissions: { dashboard_financials: boolean; reports_amounts: boolean; pl_panel: boolean }) {
  return setDoc(doc(getFirebaseDb(), "staff", uid), { permissions }, { merge: true });
}

// ─── Expenses (commissions, etc.) ──────────────────────────────────────────
export function addExpense(data: { category: string; month: string; amount: number; comment: string; createdBy: string }) {
  return addDoc(collection(getFirebaseDb(), "expenses"), { ...data, createdAt: serverTimestamp() });
}

export function deleteExpense(id: string) {
  return deleteDoc(doc(getFirebaseDb(), "expenses", id));
}

// ─── Appointments ─────────────────────────────────────────────────────────
import type { AppointmentDoc } from "../types/appointment";

export function addAppointment(data: Omit<AppointmentDoc, "id" | "createdAt">) {
  return addDoc(collection(getFirebaseDb(), "appointments"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}
