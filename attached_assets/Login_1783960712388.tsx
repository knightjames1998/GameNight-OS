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
      <div className="w-full max-w-sm text-center space-y-2">
        <h2 className="text-xl font-semibold">Check your email</h2>
        <p className="text-neutral-400 text-sm">
          A login link is on its way to {email}. It works once and expires in 15 minutes.
        </p>
        <button className="text-sm text-neutral-500 underline" onClick={() => setSent(false)}>
          Back
        </button>
      </div>
    );
  }

  const input =
    "w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-base outline-none focus:border-neutral-600";

  return (
    <div className="w-full max-w-sm space-y-3">
      <h2 className="text-xl font-semibold text-center">
        {mode === "signup" ? "Create account" : "Log in"}
      </h2>

      {mode === "signup" && (
        <input
          placeholder="Your name (what your crew sees)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          className={input}
        />
      )}
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={input}
      />
      {mode !== "link" && (
        <input
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className={input}
        />
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="w-full rounded-lg bg-neutral-100 text-neutral-950 font-semibold py-3 disabled:opacity-50"
      >
        {busy
          ? "Working..."
          : mode === "link"
            ? "Send login link"
            : mode === "signup"
              ? "Create account"
              : "Log in"}
      </button>

      {mode === "password" && (
        <p className="text-neutral-600 text-xs text-center">
          Forgot your password? Use "Email me a link" to log in, then set a
          new password from the home screen.
        </p>
      )}

      <div className="text-center text-sm text-neutral-500 space-x-3">
        {mode !== "password" && (
          <button className="underline" onClick={() => setMode("password")}>
            Use password
          </button>
        )}
        {mode !== "link" && (
          <button className="underline" onClick={() => setMode("link")}>
            Email me a link
          </button>
        )}
        {mode !== "signup" && (
          <button className="underline" onClick={() => setMode("signup")}>
            Sign up
          </button>
        )}
      </div>
    </div>
  );
}
