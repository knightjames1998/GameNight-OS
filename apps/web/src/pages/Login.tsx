import { useState } from "react";
import { api } from "../api";

// Email in, magic link out. The redirect prop rides along in the token URL
// so post-login you land where you started (matters for invite links).

export default function Login({ redirect = "/" }: { redirect?: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api("/api/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email, redirect }),
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm text-center space-y-2">
        <h2 className="text-xl font-semibold">Check your email</h2>
        <p className="text-neutral-400 text-sm">
          A login link is on its way to {email}. It works once and expires in 15 minutes.
        </p>
        <button
          className="text-sm text-neutral-500 underline"
          onClick={() => setSent(false)}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-3">
      <h2 className="text-xl font-semibold text-center">Log in</h2>
      <p className="text-neutral-400 text-sm text-center">
        No passwords. Enter your email and tap the link we send you.
      </p>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-base outline-none focus:border-neutral-600"
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        onClick={submit}
        disabled={busy}
        className="w-full rounded-lg bg-neutral-100 text-neutral-950 font-semibold py-3 disabled:opacity-50"
      >
        {busy ? "Sending..." : "Send login link"}
      </button>
    </div>
  );
}
