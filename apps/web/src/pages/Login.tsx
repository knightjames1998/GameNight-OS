import { useState } from "react";
import { api, type Me } from "../api";

// Three ways in: password login, email magic link, or brand-new signup.
// Password/signup exist to cut friction (no inbox round trip); the magic
// link remains the fallback and the only path that proves inbox ownership.

type Mode = "password" | "link" | "signup";

export default function Login({
  redirect = "/",
  onLogin,
}: {
  redirect?: string;
  onLogin?: (me: Me) => void;
}) {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "link") {
        await api("/api/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email, redirect }),
        });
        setSent(true);
      } else if (mode === "password") {
        const me = await api<Me>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        finish(me);
      } else {
        const me = await api<Me>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName: name }),
        });
        finish(me);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function finish(me: Me) {
    if (onLogin) onLogin(me);
    // Refresh keeps things simple: session cookie is set, land wherever
    // the flow intended.
    window.location.href = redirect;
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm text-center space-y-3">
        <h2 className="gn-title text-xl">Check your email</h2>
        <p className="gn-hint">
          A login link is on its way to {email}. It works once and expires in 15 minutes.
        </p>
        <button className="gn-textbtn" onClick={() => setSent(false)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-3">
      <h2 className="gn-title text-xl text-center">
        {mode === "signup" ? "Create account" : "Log in"}
      </h2>

      {mode === "signup" && (
        <input
          placeholder="Your name (what your crew sees)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          className="gn-input"
        />
      )}
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="gn-input"
      />
      {mode !== "link" && (
        <input
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="gn-input"
        />
      )}

      {error && <p className="text-sm" style={{ color: "var(--gn-danger)" }}>{error}</p>}

      <button onClick={submit} disabled={busy} className="gn-btn gn-btn--p1 w-full">
        {busy
          ? "Working..."
          : mode === "link"
            ? "Send login link"
            : mode === "signup"
              ? "Create account"
              : "Log in"}
      </button>

      {mode === "password" && (
        <p className="gn-hint text-xs text-center">
          Forgot your password? Use "Email me a link" to log in, then set a
          new password from the home screen.
        </p>
      )}

      <div className="text-center space-x-2">
        {mode !== "password" && (
          <button className="gn-textbtn" onClick={() => setMode("password")}>
            Use password
          </button>
        )}
        {mode !== "link" && (
          <button className="gn-textbtn" onClick={() => setMode("link")}>
            Email me a link
          </button>
        )}
        {mode !== "signup" && (
          <button className="gn-textbtn" onClick={() => setMode("signup")}>
            Sign up
          </button>
        )}
      </div>
    </div>
  );
}
