import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "./app";
import type { Client, Repair, Vehicle, Appointment } from "../types/client";
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

export function updateClient(id: string, data: Partial<Client>) {
  return updateDoc(doc(getFirebaseDb(), "clients", id), data as Record<string, unknown>);
}

export function deleteClient(id: string) {
  return deleteDoc(doc(getFirebaseDb(), "clients", id));
}

export function updateClientArray(
  clientId: string,
  field: "repairs" | "vehicles" | "appointments",
  value: unknown[],
) {
  return updateDoc(doc(getFirebaseDb(), "clients", clientId), { [field]: value });
}

// ─── Service Tasks ─────────────────────────────────────────────────────────
export function addServiceTask(data: Omit<ServiceTask, "id" | "createdAt">) {
  return addDoc(collection(getFirebaseDb(), "servicetasks"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export function updateServiceTask(id: string, data: Partial<ServiceTask>) {
  return updateDoc(doc(getFirebaseDb(), "servicetasks", id), data as Record<string, unknown>);
}

export function deleteServiceTask(id: string) {
  return deleteDoc(doc(getFirebaseDb(), "servicetasks", id));
}

// ─── Freezers ──────────────────────────────────────────────────────────────
export function addFreezer(data: Omit<Freezer, "id" | "createdAt">) {
  return addDoc(collection(getFirebaseDb(), "freezers"), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export function updateFreezer(id: string, data: Partial<Freezer>) {
  return updateDoc(doc(getFirebaseDb(), "freezers", id), data as Record<string, unknown>);
}

export function deleteFreezer(id: string) {
  return deleteDoc(doc(getFirebaseDb(), "freezers", id));
}

// ─── Finance ───────────────────────────────────────────────────────────────
export function saveFinance(data: Record<string, unknown>) {
  return setDoc(doc(getFirebaseDb(), "settings", "finance"), data, { merge: true });
}

// ─── Staff ─────────────────────────────────────────────────────────────────
export function saveStaffProfile(uid: string, data: StaffProfileInput) {
  return setDoc(doc(getFirebaseDb(), "staff", uid), data, { merge: true });
}
