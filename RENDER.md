# Deploying GameNight OS to Render

This app needs a live Node server, Postgres, and WebSockets. Render runs all three on its free tier. GitHub is the source of truth; the workflow is edit → push to `main` → Render auto-deploys → check the deploy log.

## The one trap to know about

**Render's free Postgres is deleted 30 days after creation.** Fine for a smoke test, terrible for a crew's real history. So: app on Render (free), database on **Neon** (free, doesn't expire). Both are free, no credit card.

---

## Step 1: Create the database (Neon)

1. Sign up at neon.tech (free tier, no card).
2. Create a project. Name it anything.
3. Copy the connection string it gives you. It looks like:
   `postgresql://user:password@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require`
4. Keep that tab open, you'll paste this into Render in step 2.

## Step 2: Create the web service (Render)

1. Sign up at render.com (free, no card).
2. **New +** → **Blueprint**.
3. Connect your GitHub and pick the `GameNight-OS` repo.
4. Render reads `render.yaml` from the repo and configures everything: build command, start command, health check, Node version, single instance.
5. It will ask for the two secrets it can't guess:
   - `DATABASE_URL` → paste the Neon connection string from step 1.
   - `RESEND_API_KEY` → your Resend key (Resend dashboard → API Keys).
6. Click **Apply** / **Create**. First deploy takes 3-5 minutes.

The build automatically pushes the database schema (all 13 tables), so there's no separate setup step. Watch the deploy log; you want to see `[✓] Changes applied` then `GameNight OS server listening`.

## Step 3: Verify

Your app is at `https://gamenight-os.onrender.com` (or whatever name Render assigns).

1. Sign up with a password. That proves the server and database are talking.
2. Create a crew, create an event, RSVP.
3. Start a bracket, score a match, and check that a second device sees the update live. That's the WebSocket test, and it's the one thing most likely to behave differently in production.
4. Open TV mode.

## Things to know

- **Cold starts.** Free services sleep after 15 minutes of inactivity. The next visitor waits 30-60 seconds for it to wake, then it's fast for everyone. For a game night, hit the URL yourself a minute before people arrive and it stays warm all evening. ($7/month kills cold starts entirely if it ever becomes annoying.)
- **Auto-deploy.** Every push to `main` on GitHub redeploys automatically. There's no separate build step to run locally — push and watch the deploy log.
- **Env vars** live in Render's dashboard (Environment tab).

## Schema changes from here on

`pnpm db:push:ci` runs on every deploy, so new tables and columns apply themselves. One caution: it uses `--force`, which accepts changes without asking. Additive changes are safe. If a future change DROPS a column, that data is gone. Nothing so far has been destructive.

## Keeping magic links working

Unchanged: links print in Render's deploy/service **Logs** tab, and Resend still only delivers email to your own address until you verify a domain. Password signup remains the friction-free path for friends.
