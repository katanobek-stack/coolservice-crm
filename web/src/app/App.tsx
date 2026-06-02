import { useEffect, useState, Component, type ReactNode, type ErrorInfo } from "react";
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

// ─── Error Boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CRM Error Boundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg)", padding: 24,
        }}>
          <div style={{
            background: "var(--bg2)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 16, padding: "28px 32px", maxWidth: 520, width: "100%",
          }}>
            <h2 style={{ color: "#f87171", marginBottom: 12, fontSize: 18 }}>
              Ошибка приложения
            </h2>
            <pre style={{
              color: "var(--text2)", fontSize: 12, whiteSpace: "pre-wrap",
              wordBreak: "break-word", marginBottom: 20,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "var(--accent)", color: "#fff", border: "none",
                borderRadius: 8, padding: "8px 18px", cursor: "pointer",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              }}
            >
              Перезагрузить страницу
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

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
    <ErrorBoundary>
      <FirebaseBootstrap>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </FirebaseBootstrap>
    </ErrorBoundary>
  );
}
