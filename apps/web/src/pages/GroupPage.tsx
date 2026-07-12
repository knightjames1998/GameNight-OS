import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type GroupDetail } from "../api";

export default function GroupPage() {
  const { id } = useParams();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<GroupDetail>(`/api/groups/${id}`)
      .then(setGroup)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  const inviteUrl = group ? `${window.location.origin}/join/${group.inviteCode}` : "";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (older webviews); the link is visible to
      // long-press copy either way.
    }
  }

  if (error) {
    return (
      <Shell>
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  }
  if (!group) {
    return (
      <Shell>
        <p className="text-neutral-500">Loading...</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Invite your crew</h2>
        <p className="text-neutral-400 text-sm">
          Anyone with this link can join. Drop it in the group chat.
        </p>
        <div className="flex gap-2 items-center">
          <code className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs break-all">
            {inviteUrl}
          </code>
          <button
            onClick={copyInvite}
            className="rounded-lg bg-neutral-100 text-neutral-950 font-semibold px-3 py-2 text-sm shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Members <span className="text-neutral-500 font-normal">({group.members.length})</span>
        </h2>
        <ul className="space-y-1">
          {group.members.map((m) => (
            <li
              key={m.userId}
              className="flex justify-between rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2"
            >
              <span>{m.displayName}</span>
              <span className="text-neutral-500 text-sm">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6 max-w-md mx-auto space-y-8">
      <Link to="/" className="text-sm text-neutral-500">
        &larr; All crews
      </Link>
      {children}
    </main>
  );
}
