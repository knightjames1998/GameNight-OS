import { Router } from "express";
import crypto from "node:crypto";
import { getDb, beerioSessions, beerioHof, eq } from "@gamenight/db";

// The Beerio Kart pack's backend: a faithful reimplementation of the
// original standalone app's API contracts (artifacts/api-server in the
// Beerio-Kart-Bracket repo), backed by Postgres instead of its store.
// The vendored frontend calls these unmodified. Everything here is
// PUBLIC by design: spectators are never logged in. Mount before any
// auth'd router on the bare /api path.

export const beerioRouter = Router();

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genCode(len: number): string {
  return Array.from(crypto.randomBytes(len), (b) => ALPHABET[b % ALPHABET.length]!).join("");
}
const HOF_CODE_RE = /^[A-Z2-9]{4,12}$/;
const SID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// ---------- Live sessions ----------

beerioRouter.post("/sessions", async (req, res) => {
  const state = req.body?.state;
  if (state === undefined) {
    res.status(400).json({ error: "missing state" });
    return;
  }
  const db = getDb();
  let code = genCode(4);
  for (let tries = 0; tries < 6; tries++) {
    const existing = await db
      .select({ code: beerioSessions.code })
      .from(beerioSessions)
      .where(eq(beerioSessions.code, code))
      .limit(1);
    if (!existing[0]) break;
    code = genCode(4);
  }
  await db.insert(beerioSessions).values({ code, state });
  res.json({ code });
});

beerioRouter.put("/sessions/:code", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const state = req.body?.state;
  if (state === undefined) {
    res.status(400).json({ error: "missing state" });
    return;
  }
  await getDb()
    .update(beerioSessions)
    .set({ state, updatedAt: new Date() })
    .where(eq(beerioSessions.code, code));
  res.json({ ok: true });
});

beerioRouter.get("/sessions/:code", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const row = (
    await getDb().select().from(beerioSessions).where(eq(beerioSessions.code, code)).limit(1)
  )[0];
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ state: row.state, updatedAt: row.updatedAt.toISOString() });
});

// ---------- Spectator predictions ----------
// Per-spectator merge with lock enforcement, ported from the original:
// once a result is recorded, that pick is frozen even for stale clients.

beerioRouter.put("/sessions/:code/predictions/:sid", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const sid = String(req.params.sid || "");
  if (!SID_RE.test(sid)) {
    res.status(400).json({ error: "bad spectator id" });
    return;
  }
  const db = getDb();
  const row = (
    await db.select().from(beerioSessions).where(eq(beerioSessions.code, code)).limit(1)
  )[0];
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const name = String(req.body?.name ?? "").slice(0, 24);
  const picksRaw = req.body?.picks;
  if (!picksRaw || typeof picksRaw !== "object") {
    res.status(400).json({ error: "missing picks" });
    return;
  }
  const picks: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(picksRaw as Record<string, unknown>)) {
    if (n >= 200) break;
    if (typeof k !== "string" || k.length > 40) continue;
    picks[k] = String(v).slice(0, 24);
    n++;
  }

  const state = row.state as { results?: Record<string, unknown>; gpLog?: unknown[] } | null;
  const isLocked = (k: string): boolean => {
    if (k.startsWith("M:")) return state?.results?.[k.slice(2)] !== undefined;
    if (k.startsWith("H:")) {
      const i = Number(k.slice(2));
      return Number.isInteger(i) && Array.isArray(state?.gpLog?.[i]);
    }
    return false;
  };

  const prior = (row.predictions ?? {}) as Record<string, { picks?: Record<string, string> }>;
  const priorPicks =
    prior[sid]?.picks && typeof prior[sid]!.picks === "object" ? prior[sid]!.picks! : {};
  for (const k of Object.keys(picks)) {
    if (isLocked(k) && priorPicks[k] === undefined) delete picks[k];
  }
  for (const [k, v] of Object.entries(priorPicks)) {
    if (isLocked(k)) picks[k] = v;
  }

  const predictions = {
    ...prior,
    [sid]: { name, picks, updatedAt: new Date().toISOString() },
  };
  await db
    .update(beerioSessions)
    .set({ predictions })
    .where(eq(beerioSessions.code, code));
  res.json({ ok: true });
});

beerioRouter.get("/sessions/:code/predictions", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const row = (
    await getDb()
      .select({ predictions: beerioSessions.predictions })
      .from(beerioSessions)
      .where(eq(beerioSessions.code, code))
      .limit(1)
  )[0];
  res.json({ predictions: row?.predictions ?? {} });
});

// ---------- Hall of Fame (the lifetime stats bridge) ----------

beerioRouter.post("/hof", async (req, res) => {
  const data = req.body?.data ?? { log: [] };
  const db = getDb();
  let code = genCode(8);
  for (let tries = 0; tries < 6; tries++) {
    const existing = await db
      .select({ code: beerioHof.code })
      .from(beerioHof)
      .where(eq(beerioHof.code, code))
      .limit(1);
    if (!existing[0]) break;
    code = genCode(8);
  }
  await db.insert(beerioHof).values({ code, data });
  res.json({ code });
});

beerioRouter.get("/hof/:code", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!HOF_CODE_RE.test(code)) {
    res.status(400).json({ error: "bad code" });
    return;
  }
  const row = (await getDb().select().from(beerioHof).where(eq(beerioHof.code, code)).limit(1))[0];
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ data: row.data, updatedAt: row.updatedAt.toISOString() });
});

beerioRouter.put("/hof/:code", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (!HOF_CODE_RE.test(code)) {
    res.status(400).json({ error: "bad code" });
    return;
  }
  const data = req.body?.data;
  if (data === undefined) {
    res.status(400).json({ error: "missing data" });
    return;
  }
  await getDb()
    .update(beerioHof)
    .set({ data, updatedAt: new Date() })
    .where(eq(beerioHof.code, code));
  res.json({ ok: true });
});
