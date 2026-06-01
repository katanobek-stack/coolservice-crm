import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { saveStaffProfile } from "../api/staff";
import { getFirebaseAuth, getFirebaseDb } from "../../../shared/firebase";
import type { StaffMember, StaffRole } from "../../../shared/types/staff";

interface AuthContextValue {
  user: User | null;
  authLoading: boolean;
  loginLoading: boolean;
  loginError: string;
  staff: StaffMember[];
  myProfile: StaffMember | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  saveProfile: (name: string, role: StaffRole) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapAuthError(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  if (code === "auth/invalid-credential") {
    return "Неверный email или пароль";
  }

  if (error instanceof Error) {
    return `Ошибка: ${error.message}`;
  }

  return "Ошибка входа";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
      setLoginLoading(false);
      setLoginError("");
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setStaff([]);
      return;
    }

    const unsubscribe = onSnapshot(collection(getFirebaseDb(), "staff"), (snapshot) => {
      setStaff(
        snapshot.docs.map(
          (docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as StaffMember,
        ),
      );
    });

    return unsubscribe;
  }, [user]);

  const myProfile = useMemo(
    () => (user ? staff.find((member) => member.id === user.uid) : undefined),
    [staff, user],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    setLoginLoading(true);
    setLoginError("");

    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    } catch (error) {
      setLoginError(mapAuthError(error));
      setLoginLoading(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(getFirebaseAuth());
  }, []);

  const saveProfile = useCallback(
    async (name: string, role: StaffRole) => {
      if (!user) {
        return;
      }

      await saveStaffProfile(user.uid, {
        name: name.trim(),
        role,
        email: user.email ?? "",
      });
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      authLoading,
      loginLoading,
      loginError,
      staff,
      myProfile,
      signIn,
      signOutUser,
      saveProfile,
    }),
    [
      authLoading,
      loginError,
      loginLoading,
      myProfile,
      saveProfile,
      signIn,
      signOutUser,
      staff,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
