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
  clients:  Client[];
  staff:    StaffMember[];
  tasks:    ServiceTask[];
  freezers: Freezer[];
  finance:  Record<string, unknown>;
  expenses: Expense[];
  loaded:   boolean;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [clients,  setClients]  = useState<Client[]>([]);
  const [staff,    setStaff]    = useState<StaffMember[]>([]);
  const [tasks,    setTasks]    = useState<ServiceTask[]>([]);
  const [freezers, setFreezers] = useState<Freezer[]>([]);
  const [finance,  setFinance]  = useState<Record<string, unknown>>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    const db = getFirebaseDb();

    const unsubs = [
      onSnapshot(
        query(collection(db, "clients"), orderBy("createdAt", "desc")),
        (snap) => {
          setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Client));
          setLoadCount((n) => n + 1);
        },
      ),
      onSnapshot(collection(db, "staff"), (snap) => {
        setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffMember));
        setLoadCount((n) => n + 1);
      }),
      onSnapshot(collection(db, "servicetasks"), (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ServiceTask));
        setLoadCount((n) => n + 1);
      }),
      onSnapshot(collection(db, "freezers"), (snap) => {
        setFreezers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Freezer));
        setLoadCount((n) => n + 1);
      }),
      onSnapshot(
        doc(db, "settings", "finance"),
        (d) => {
          setFinance(d.exists() ? (d.data() as Record<string, unknown>) : {});
          setLoadCount((n) => n + 1);
        },
        () => {
          setFinance({});
          setLoadCount((n) => n + 1);
        },
      ),
      onSnapshot(
        query(collection(db, "expenses"), orderBy("createdAt", "desc")),
        (snap) => {
          setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Expense));
          setLoadCount((n) => n + 1);
        },
        () => {
          setExpenses([]);
          setLoadCount((n) => n + 1);
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
      loaded: loadCount >= 6,
    }),
    [clients, staff, tasks, freezers, finance, expenses, loadCount],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
