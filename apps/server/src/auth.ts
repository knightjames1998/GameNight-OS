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
import { getDb, users, magicLinkTokens, sessions, and, eq, gt, isNull, desc } from "@gamenight/db";
import { sendMagicLink } from "./email.js";

// A request row's code and link share one expiry: 10 minutes. Short because
// the code is the primary path now and is typed in immediately.
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_THROTTLE_MS = 60 * 1000; // one send per email per minute
const MAX_CODE_ATTEMPTS = 5; // wrong guesses before a code is burned
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

/**
 * Find or create the user for a verified email, then start their session.
 * Shared by the magic-link POST /verify and the code POST /verify-code so
 * both log in identically. New users get a name from their email prefix and
 * can change it on the home screen.
 */
async function loginVerifiedEmail(res: Response, email: string) {
  const db = getDb();
  let user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user) {
    const defaultName = email.split("@")[0] ?? "Player";
    user = (await db.insert(users).values({ email, displayName: defaultName }).returning())[0]!;
  }
  await startSession(res, user.id);
  return user;
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

/**
 * Step 1: user submits an email, we create a one-time row carrying BOTH a
 * 6-digit code (the primary path) and a magic-link token (desktop
 * fallback), and email them. A malformed address still gets a 400 so a
 * typo is caught; but whether the address has an account is never revealed,
 * and the send throttle is never revealed either.
 */
authRouter.post("/request-link", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const redirect = safeRedirect(req.body?.redirect);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email" });
    return;
  }

  const db = getDb();

  // Throttle: one send per email per minute. If a still-live, unused row was
  // created under a minute ago, silently succeed without sending another.
  // Same { ok: true } either way, so the throttle can't be probed.
  const recent = (
    await db
      .select({ token: magicLinkTokens.token })
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.email, email),
          isNull(magicLinkTokens.usedAt),
          gt(magicLinkTokens.expiresAt, new Date()),
          gt(magicLinkTokens.createdAt, new Date(Date.now() - RESEND_THROTTLE_MS)),
        ),
      )
      .limit(1)
  )[0];
  if (recent) {
    res.json({ ok: true });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  // Cryptographically random, zero-padded so codes like 004217 are valid.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(magicLinkTokens).values({
    token,
    email,
    code,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const base = `${req.protocol}://${req.get("host")}`;
  const url = `${base}/api/auth/verify?token=${token}&redirect=${encodeURIComponent(redirect)}`;
  await sendMagicLink(email, url, code);

  res.json({ ok: true });
});

/**
 * The code path. The typed code never leaves the app, so the session cookie
 * lands in the same browser context the user is in, which the emailed link
 * can't guarantee for an installed iOS PWA. One generic error for every
 * failure mode; a per-row attempt cap kills a code that's being guessed.
 */
authRouter.post("/verify-code", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const code = String(req.body?.code ?? "").replace(/\D/g, "");
  const redirect = safeRedirect(req.body?.redirect);
  const db = getDb();
  const now = new Date();

  const match = (
    await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.email, email),
          eq(magicLinkTokens.code, code),
          isNull(magicLinkTokens.usedAt),
          gt(magicLinkTokens.expiresAt, now),
        ),
      )
      .orderBy(desc(magicLinkTokens.createdAt))
      .limit(1)
  )[0];

  if (!match) {
    // Wrong / expired / no such email all land here. Burn an attempt against
    // the newest live row for this email so the code can't be guessed
    // indefinitely; at the cap, mark it used so it's dead.
    const live = (
      await db
        .select()
        .from(magicLinkTokens)
        .where(
          and(
            eq(magicLinkTokens.email, email),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, now),
          ),
        )
        .orderBy(desc(magicLinkTokens.createdAt))
        .limit(1)
    )[0];
    if (live) {
      const attempts = live.attempts + 1;
      await db
        .update(magicLinkTokens)
        .set({ attempts, usedAt: attempts >= MAX_CODE_ATTEMPTS ? new Date() : null })
        .where(eq(magicLinkTokens.token, live.token));
    }
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }

  await db
    .update(magicLinkTokens)
    .set({ usedAt: new Date() })
    .where(eq(magicLinkTokens.token, match.token));

  const user = await loginVerifiedEmail(res, match.email);
  res.json({ id: user.id, email: user.email, displayName: user.displayName });
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

  await loginVerifiedEmail(res, link.email);
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

// Standalone Arcade-themed chrome for the magic-link tap-through pages
// (deep plum, coral action, Luckiest Guy wordmark). These render outside the
// SPA, so they pull the fonts in directly.
const PAGE_HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#17111f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Nunito:wght@600;700;800&display=swap" rel="stylesheet">
<title>GameNight OS</title>`;

const PAGE_STYLE =
  "margin:0;min-height:100dvh;display:flex;flex-direction:column;align-items:center;" +
  "justify-content:center;gap:18px;background:#17111f;color:#f4ecff;" +
  "font-family:Nunito,system-ui,sans-serif;padding:24px;text-align:center";

const WORDMARK =
  `<h1 style="margin:0;font-family:'Luckiest Guy',system-ui,cursive;font-size:32px;` +
  `letter-spacing:.5px;color:#fff;text-shadow:0 0 14px rgba(255,90,95,.45),2px 3px 0 rgba(0,0,0,.35)">` +
  `GameNight OS</h1>`;

/** The tap-through page. The form POST is what preview bots can't fake. */
function confirmPage(token: string, redirect: string): string {
  return `<!doctype html><html lang="en"><head>${PAGE_HEAD}</head>
<body style="${PAGE_STYLE}">
${WORDMARK}
<p style="color:#c3b6d6;margin:0">One tap to finish logging in.</p>
<form method="POST" action="/api/auth/verify">
<input type="hidden" name="token" value="${token}">
<input type="hidden" name="redirect" value="${redirect.replace(/"/g, "")}">
<button type="submit" style="background:#ff5a5f;color:#1a0d0e;border:0;border-radius:12px;
padding:15px 44px;font-size:16px;font-weight:800;font-family:inherit;cursor:pointer;
box-shadow:0 4px 0 #b8383c">Log in</button>
</form>
</body></html>`;
}

function expiredPage(): string {
  return `<!doctype html><html lang="en"><head>${PAGE_HEAD}</head>
<body style="${PAGE_STYLE}">
${WORDMARK}
<p style="color:#c3b6d6;margin:0">This login link is invalid or expired.<br>
Go back to the app and request a new one.</p>
<a href="/" style="color:#35e0c4;font-weight:700;text-decoration:none">Back to the app</a>
</body></html>`;
}

/** Only allow same-app paths so the redirect can't point somewhere hostile. */
function safeRedirect(value: unknown): string {
  const s = String(value ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}
