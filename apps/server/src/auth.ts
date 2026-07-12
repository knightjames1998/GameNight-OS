import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
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

/** Step 2: user clicks the emailed link. Consume token, create session. */
authRouter.get("/verify", async (req, res) => {
  const token = String(req.query.token ?? "");
  const redirect = safeRedirect(req.query.redirect);
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
    res
      .status(400)
      .send("This login link is invalid or expired. Go back to the app and request a new one.");
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

  const session = (
    await db
      .insert(sessions)
      .values({ userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .returning()
  )[0]!;

  res.cookie(COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
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

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json(req.user);
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

/** Only allow same-app paths so the redirect can't point somewhere hostile. */
function safeRedirect(value: unknown): string {
  const s = String(value ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}
