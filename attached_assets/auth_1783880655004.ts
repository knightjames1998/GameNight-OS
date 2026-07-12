import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const hash = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(hash, Buffer.from(expected, "hex"));
}
import { getDb, users, magicLinkTokens, sessions, and, eq, gt, isNull } from "@gamenight/db";
import { sendMagicLink } from "./email.js";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE = "gn_session";

// ---------- Middleware ----------

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; displayName: string };
}

/** Loads the session cookie into req.user if valid. Never blocks. */
export async function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const sid = req.cookies?.[COOKIE];
    if (!sid) return next();
    const db = getDb();
    const rows = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (rows[0]) req.user = rows[0];
  } catch {
    // Bad cookie shape etc. Treat as logged out.
  }
  next();
}

/** Blocks the request with 401 unless a user is attached. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  next();
}

// ---------- Routes ----------

export const authRouter = Router();

async function startSession(res: Response, userId: string) {
  const session = (
    await getDb()
      .insert(sessions)
      .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .returning()
  )[0]!;
  res.cookie(COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign up with email + password. No email verification, which is an
 * accepted pre-launch tradeoff (anyone could claim any address); magic
 * links remain the path that proves inbox ownership.
 */
authRouter.post("/register", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const displayName = String(req.body?.displayName ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Enter a valid email" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  if (displayName.length < 1 || displayName.length > 30) {
    res.status(400).json({ error: "Name must be 1-30 characters" });
    return;
  }

  const db = getDb();
  const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (existing) {
    res.status(409).json({ error: "That email already has an account. Log in instead." });
    return;
  }

  const user = (
    await db
      .insert(users)
      .values({ email, displayName, passwordHash: await hashPassword(password) })
      .returning()
  )[0]!;
  await startSession(res, user.id);
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});

/** Log in with email + password (for accounts that have set one). */
authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const db = getDb();
  const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  // One generic error for every failure mode; no account probing.
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  await startSession(res, user.id);
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
});

/** Set or change a password from inside a logged-in session. */
authRouter.patch("/password", requireAuth, async (req: AuthedRequest, res) => {
  const password = String(req.body?.password ?? "");
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  await getDb()
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, req.user!.id));
  res.json({ ok: true });
});

/** Step 1: user submits an email, we create a one-time token and send it. */
authRouter.post("/request-link", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const redirect = safeRedirect(req.body?.redirect);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email" });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const db = getDb();
  await db.insert(magicLinkTokens).values({
    token,
    email,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });

  const base = `${req.protocol}://${req.get("host")}`;
  const url = `${base}/api/auth/verify?token=${token}&redirect=${encodeURIComponent(redirect)}`;
  await sendMagicLink(email, url);

  res.json({ ok: true });
});

/**
 * Step 2a: user opens the emailed link. This GET consumes NOTHING.
 * Messaging apps and email scanners prefetch URLs to build previews, which
 * used to burn the one-time token before the human ever tapped it. So the
 * link now lands on a tiny page, and only pressing the button (a POST,
 * which preview bots never do) actually logs you in. It also means a failed
 * page load can be retried: just reload and tap again.
 */
authRouter.get("/verify", async (req, res) => {
  const token = String(req.query.token ?? "");
  const redirect = safeRedirect(req.query.redirect);

  const found = await getDb()
    .select()
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.token, token),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!found[0]) {
    res.status(400).send(expiredPage());
    return;
  }
  res.send(confirmPage(token, redirect));
});

/** Step 2b: the button press. NOW consume the token and create the session. */
authRouter.post("/verify", async (req, res) => {
  const token = String(req.body?.token ?? "");
  const redirect = safeRedirect(req.body?.redirect);
  const db = getDb();

  const found = await db
    .select()
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.token, token),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const link = found[0];
  if (!link) {
    res.status(400).send(expiredPage());
    return;
  }

  await db
    .update(magicLinkTokens)
    .set({ usedAt: new Date() })
    .where(eq(magicLinkTokens.token, token));

  // Find or create the user. New users get a name from their email prefix;
  // they can change it on the home screen.
  let user = (await db.select().from(users).where(eq(users.email, link.email)).limit(1))[0];
  if (!user) {
    const defaultName = link.email.split("@")[0] ?? "Player";
    user = (
      await db.insert(users).values({ email: link.email, displayName: defaultName }).returning()
    )[0]!;
  }

  await startSession(res, user.id);
  res.redirect(redirect);
});

authRouter.post("/logout", async (req: AuthedRequest, res) => {
  const sid = req.cookies?.[COOKIE];
  if (sid) {
    try {
      await getDb().delete(sessions).where(eq(sessions.id, sid));
    } catch {
      // Session already gone; fine.
    }
  }
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const row = (
    await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1)
  )[0];
  res.json({ ...req.user, hasPassword: !!row?.passwordHash });
});

authRouter.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  const displayName = String(req.body?.displayName ?? "").trim();
  if (displayName.length < 1 || displayName.length > 30) {
    res.status(400).json({ error: "Name must be 1-30 characters" });
    return;
  }
  await getDb().update(users).set({ displayName }).where(eq(users.id, req.user!.id));
  res.json({ ...req.user!, displayName });
});

const PAGE_STYLE =
  "margin:0;min-height:100dvh;display:flex;flex-direction:column;align-items:center;" +
  "justify-content:center;gap:16px;background:#0a0a0a;color:#f5f5f5;" +
  "font-family:system-ui,sans-serif;padding:24px;text-align:center";

/** The tap-through page. The form POST is what preview bots can't fake. */
function confirmPage(token: string, redirect: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameNight OS</title></head>
<body style="${PAGE_STYLE}">
<h1 style="margin:0;font-size:28px">GameNight OS</h1>
<p style="color:#a3a3a3;margin:0">One tap to finish logging in.</p>
<form method="POST" action="/api/auth/verify">
<input type="hidden" name="token" value="${token}">
<input type="hidden" name="redirect" value="${redirect.replace(/"/g, "")}">
<button type="submit" style="background:#f5f5f5;color:#0a0a0a;border:0;border-radius:8px;
padding:14px 40px;font-size:16px;font-weight:600">Log in</button>
</form>
</body></html>`;
}

function expiredPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameNight OS</title></head>
<body style="${PAGE_STYLE}">
<h1 style="margin:0;font-size:28px">GameNight OS</h1>
<p style="color:#a3a3a3;margin:0">This login link is invalid or expired.<br>
Go back to the app and request a new one.</p>
<a href="/" style="color:#f5f5f5">Back to the app</a>
</body></html>`;
}

/** Only allow same-app paths so the redirect can't point somewhere hostile. */
function safeRedirect(value: unknown): string {
  const s = String(value ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}
