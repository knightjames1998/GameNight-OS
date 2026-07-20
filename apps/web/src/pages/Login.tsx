import { useEffect, useRef, useState } from "react";
import { api, type Me } from "../api";

// Three ways in: password login, email code, or brand-new signup. Password
// and signup cut friction (no inbox round trip). The email path sends a
// 6-digit code AND a magic link: the code is primary because a typed code
// never leaves the app, so on an installed iOS PWA the session cookie lands
// in the app's own context instead of Safari's. The link is a desktop
// fallback.

type Mode = "password" | "link" | "signup";
const RESEND_SECONDS = 60;

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
  // Once a code is on its way, the link mode swaps to the code-entry step.
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  // Resend countdown, matching the server's 60s send throttle.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function finish(me: Me) {
    if (onLogin) onLogin(me);
    // Same as the password path: a same-origin reload lands wherever the
    // flow intended and re-runs the app's session check.
    window.location.href = redirect;
  }

  async function requestCode() {
    await api("/api/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email, redirect }),
    });
    setResendIn(RESEND_SECONDS);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "link") {
        await requestCode();
        setCode("");
        setCodeStep(true);
      } else if (mode === "password") {
        finish(
          await api<Me>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          }),
        );
      } else {
        finish(
          await api<Me>("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ email, password, displayName: name }),
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(value: string) {
    setError(null);
    setBusy(true);
    try {
      finish(
        await api<Me>("/api/auth/verify-code", {
          method: "POST",
          body: JSON.stringify({ email, code: value, redirect }),
        }),
      );
    } catch (e) {
      // Clear and refocus so the next attempt is one keystroke away.
      setError(e instanceof Error ? e.message : "Invalid or expired code");
      setCode("");
      codeRef.current?.focus();
      setBusy(false);
    }
    // On success finish() navigates away, so busy stays true intentionally.
  }

  function onCodeChange(raw: string) {
    // Strip anything non-numeric so a pasted code with spaces or dashes
    // still works; onChange fires on paste with the whole value.
    const v = raw.replace(/\D/g, "").slice(0, 6);
    setCode(v);
    if (v.length === 6 && !busy) verifyCode(v);
  }

  async function resend() {
    if (resendIn > 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      await requestCode();
      setCode("");
      codeRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resend");
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 2: code entry ----
  if (codeStep) {
    return (
      <div className="w-full max-w-sm space-y-3">
        <h2 className="gn-title text-xl text-center">Enter your code</h2>
        <p className="gn-hint text-center">
          We sent a 6-digit code to {email}. It expires in 10 minutes.
        </p>

        <input
          ref={codeRef}
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          placeholder="------"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verifyCode(code)}
          className="gn-input text-center"
          style={{ fontSize: "28px", letterSpacing: "12px", fontFamily: "ui-monospace, monospace" }}
        />

        {error && <p className="text-sm text-center" style={{ color: "var(--gn-danger)" }}>{error}</p>}

        <button
          onClick={() => code.length === 6 && verifyCode(code)}
          disabled={busy || code.length !== 6}
          className="gn-btn gn-btn--p1 w-full"
        >
          {busy ? "Checking..." : "Log in"}
        </button>

        <div className="flex items-center justify-between">
          <button
            className="gn-textbtn"
            onClick={() => {
              setCodeStep(false);
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
          <button className="gn-textbtn" onClick={resend} disabled={resendIn > 0 || busy}>
            {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
          </button>
        </div>

        <p className="gn-hint text-xs text-center">
          On a computer? The same email has a login link you can click instead.
        </p>
      </div>
    );
  }

  // ---- Step 1: email (+ password / name) ----
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
        onKeyDown={(e) => e.key === "Enter" && mode === "link" && submit()}
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
            ? "Email me a code"
            : mode === "signup"
              ? "Create account"
              : "Log in"}
      </button>

      {mode === "password" && (
        <p className="gn-hint text-xs text-center">
          Forgot your password? Use "Email me a code" to log in, then set a
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
            Email me a code
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
