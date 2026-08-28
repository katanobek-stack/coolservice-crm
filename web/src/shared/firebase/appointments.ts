import {
  addDoc,
  collection,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseDb } from "./app";
import {
  removeDocumentIfUnchanged,
  updateDocumentFieldsIfUnchanged,
} from "./concurrency";
import type { Appointment } from "../types/appointment";

export type NewAppointment = Omit<Appointment, "id" | "createdAt">;

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)]),
    ) as T;
  }
  return value;
}

export function createAppointment(
  data: NewAppointment,
  firestore: Firestore = getFirebaseDb(),
) {
  return addDoc(collection(firestore, "appointments"), {
    ...withoutUndefined(data),
    createdAt: serverTimestamp(),
  });
}

export function updateAppointment(
  target: Appointment,
  updates: Partial<Appointment>,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return updateDocumentFieldsIfUnchanged("appointments", target, updates, firestore);
}

export function deleteAppointment(
  target: Appointment,
  firestore: Firestore = getFirebaseDb(),
): Promise<void> {
  return removeDocumentIfUnchanged("appointments", target, firestore);
}
