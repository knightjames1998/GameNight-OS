// Make async route handlers crash-safe, process-wide.
//
// Express 4 does not catch a rejected promise returned from a handler: the
// rejection escapes as an unhandledRejection and (Node 15+) takes the whole
// process down — and with it the in-process WebSocket hub, dropping every
// connected screen until Render cold-starts (~30-60s). This is the failure
// the Smash schema-miss surfaced: one missing-column query crash-looped the
// server instead of returning a 500.
//
// Rather than wrap every handler by hand, this patches the Router's route-
// registration methods once so any handler that throws or rejects is routed
// to next(err), where the error middleware in index.ts turns it into a 500.
// It MUST be imported before any route module registers handlers, so it is
// the first import in index.ts.
//
// No new dependency (the lockfile must stay frozen for Render's install).

import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Forward a sync throw or a rejected promise from `fn` to next(err). */
function wrap(fn: RequestHandler): RequestHandler {
  return function (this: unknown, req: Request, res: Response, next: NextFunction) {
    try {
      const out = (fn as (r: Request, s: Response, n: NextFunction) => unknown).call(
        this,
        req,
        res,
        next,
      );
      if (out && typeof (out as { then?: unknown }).then === "function") {
        (out as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

// Auto-wrap plain middleware/route functions only. Skip 4-arg error handlers
// (Express identifies them by arity, so the wrapper must not change it) and
// mounted sub-routers (they carry a `.stack`), leaving their behaviour and
// arity untouched.
function shouldWrap(h: unknown): h is RequestHandler {
  return (
    typeof h === "function" &&
    (h as (...a: unknown[]) => unknown).length < 4 &&
    !(h as { stack?: unknown }).stack
  );
}

const proto = express.Router as unknown as Record<string, unknown>;
for (const method of ["use", "all", "get", "post", "put", "patch", "delete", "options", "head"]) {
  const original = proto[method];
  if (typeof original !== "function") continue;
  const orig = original as (...args: unknown[]) => unknown;
  proto[method] = function (this: unknown, ...args: unknown[]) {
    return orig.apply(this, args.map((a) => (shouldWrap(a) ? wrap(a) : a)));
  };
}

// Last-resort net for anything a request handler can't catch (app-level
// middleware, WebSocket callbacks, timers): log loudly but keep the process
// — and the WebSocket hub — alive rather than letting Node exit. The route
// wrapper above is the primary fix; these should rarely fire.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
