import { useEffect, useState, type ReactNode } from "react";
import { isFirebaseConfigured } from "../shared/config/env";
import { initFirebase } from "../shared/firebase";
import {
  AuthProvider,
  LoadingScreen,
  LoginView,
  SetupView,
  useAuth,
} from "../features/auth";
import { AppShell } from "./AppShell";

type FirebaseStatus = "loading" | "ready" | "missing-env" | "error";

function AuthGate() {
  const { user, authLoading, myProfile } = useAuth();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <LoginView />;
  }

  if (!myProfile) {
    return <SetupView />;
  }

  return <AppShell />;
}

function FirebaseBootstrap({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FirebaseStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setStatus("missing-env");
      return;
    }

    try {
      initFirebase();
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Не удалось инициализировать Firebase",
      );
    }
  }, []);

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "missing-env") {
    return (
      <main className="app app--message">
        <section className="app__card app__card--warn">
          <h2>Добавьте ключи Firebase</h2>
          <p>
            Заполните <code>web/.env</code> и перезапустите <code>npm run dev</code>.
          </p>
        </section>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="app app--message">
        <section className="app__card app__card--error">
          <h2>Ошибка Firebase</h2>
          <p>{errorMessage}</p>
        </section>
      </main>
    );
  }

  return children;
}

export default function App() {
  return (
    <FirebaseBootstrap>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </FirebaseBootstrap>
  );
}
