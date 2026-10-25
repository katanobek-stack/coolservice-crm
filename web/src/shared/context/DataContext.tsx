import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getFirebaseDb } from "../firebase/app";
import type { Client } from "../types/client";
import type { ServiceTask } from "../types/task";
import type { Freezer } from "../types/freezer";
import type { StaffMember } from "../types/staff";
import type { Appointment } from "../types/appointment";
import type { IntakeRepair } from "../types/intake";

import { DATA_SOURCES, initialDataStatus, markDataStatus, type DataSource, type SourceStatus, type DataStatus } from "./dataReadiness";

export interface Expense {
  id:         string;
  category:   string;
  month:      string;
  amount:     number;
  comment:    string;
  createdBy:  string;
  createdAt:  unknown;
}

interface DataContextValue {
  clients:      Client[];
  staff:        StaffMember[];
  tasks:        ServiceTask[];
  freezers:     Freezer[];
  finance:      Record<string, unknown>;
  expenses:     Expense[];
  appointments: Appointment[];
  intakeRepairs: IntakeRepair[];
  loaded:       boolean;
  sourceStatus: DataStatus;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [clients,      setClients]      = useState<Client[]>([]);
  const [staff,        setStaff]        = useState<StaffMember[]>([]);
  const [tasks,        setTasks]        = useState<ServiceTask[]>([]);
  const [freezers,     setFreezers]     = useState<Freezer[]>([]);
  const [finance,      setFinance]      = useState<Record<string, unknown>>({});
  const [expenses,     setExpenses]     = useState<Expense[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [intakeRepairs, setIntakeRepairs] = useState<IntakeRepair[]>([]);
  const [sourceStatus, setSourceStatus] = useState(initialDataStatus);
  const mark = (source: DataSource, status: SourceStatus) => setSourceStatus(current => markDataStatus(current, source, status));

  useEffect(() => {
    const db = getFirebaseDb();

    const unsubs = [
      onSnapshot(
        query(collection(db, "clients"), orderBy("createdAt", "desc")),
        (snap) => {
          setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Client));
          mark("clients", "ready");
        },
        () => mark("clients", "error"),
      ),
      onSnapshot(collection(db, "staff"), (snap) => {
        setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffMember));
        mark("staff", "ready");
      }, () => mark("staff", "error")),
      onSnapshot(collection(db, "servicetasks"), (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ServiceTask));
        mark("tasks", "ready");
      }, () => mark("tasks", "error")),
      onSnapshot(collection(db, "freezers"), (snap) => {
        setFreezers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Freezer));
        mark("freezers", "ready");
      }, () => mark("freezers", "error")),
      onSnapshot(
        doc(db, "settings", "finance"),
        (d) => {
          setFinance(d.exists() ? (d.data() as Record<string, unknown>) : {});
          mark("finance", "ready");
        },
        () => {
          setFinance({});
          mark("finance", "error");
        },
      ),
      onSnapshot(
        query(collection(db, "expenses"), orderBy("createdAt", "desc")),
        (snap) => {
          setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Expense));
          mark("expenses", "ready");
        },
        () => {
          setExpenses([]);
          mark("expenses", "error");
        },
      ),
      onSnapshot(
        query(collection(db, "appointments"), orderBy("createdAt", "desc")),
        (snap) => {
          setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Appointment));
          mark("appointments", "ready");
        },
        () => {
          setAppointments([]);
          mark("appointments", "error");
        },
      ),
      // No orderBy: the collection is small and transient, IntakeTab sorts by
      // createdAt itself. A query orderBy would also silently drop any doc
      // missing the field.
      onSnapshot(
        collection(db, "intakeRepairs"),
        (snap) => {
          setIntakeRepairs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as IntakeRepair));
          mark("intakeRepairs", "ready");
        },
        (err) => {
          console.error("[DataProvider] intakeRepairs listener error:", err);
          setIntakeRepairs([]);
          mark("intakeRepairs", "error");
        },
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      clients,
      staff,
      tasks,
      freezers,
      finance,
      expenses,
      appointments,
      intakeRepairs,
      loaded: DATA_SOURCES.every(source => sourceStatus[source] !== "loading"),
      sourceStatus,
    }),
    [clients, staff, tasks, freezers, finance, expenses, appointments, intakeRepairs, sourceStatus],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
