// Tests for the crash-safety patch in src/async-safe.ts.
//
// This is the server package's first test file. It exists partly to give the
// `pnpm test` glob something to find, but the subject was chosen because it
// is the one piece of server code whose failure mode is the worst: if the
// Router patch stops wrapping handlers, a single rejected promise takes the
// process down and the in-process WebSocket hub with it, dropping every
// connected screen until Render cold-starts. That behaviour was verified by
// hand once when it shipped (see the 2026-07-16 decision log entry) and then
// never captured. It is captured here.
//
// No database and no listening server: the patch is observable directly on
// the Router prototype, so this stays a pure unit test. Run with `pnpm test`.
//
// Importing async-safe has global side effects (it patches express.Router and
// registers process handlers). That is safe here because node:test runs each
// test FILE in its own process.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/async-safe.js";
import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";

type Layer = {
  handle: RequestHandler;
  route?: { path: string; stack: { handle: RequestHandler }[] };
};

/** The handler Express actually stored for a route, after any wrapping. */
function routeHandler(router: express.Router, path: string): RequestHandler {
  const stack = (router as unknown as { stack: Layer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path);
  assert.ok(layer?.route, `no route registered for ${path}`);
  return layer.route.stack[0]!.handle;
}

/** The middleware Express actually stored for a bare `use`, after wrapping. */
function lastUseHandler(router: express.Router): RequestHandler {
  const stack = (router as unknown as { stack: Layer[] }).stack;
  return stack[stack.length - 1]!.handle;
}

const fakeReq = () => ({}) as Request;
const fakeRes = () => ({}) as Response;

/** Invoke a stored handler and resolve with whatever it passed to next(). */
function callHandler(h: RequestHandler): Promise<unknown> {
  return new Promise((resolve) => {
    const next = ((err?: unknown) => resolve(err)) as NextFunction;
    h(fakeReq(), fakeRes(), next);
    // A handler that never calls next (the normal success path) should not
    // hang the test, so settle on the next tick with undefined.
    setImmediate(() => resolve(undefined));
  });
}

test("a rejected promise is routed to next(err) instead of escaping", async () => {
  const router = express.Router();
  const boom = new Error("async boom");
  router.get("/async", async () => {
    throw boom;
  });

  const err = await callHandler(routeHandler(router, "/async"));
  assert.equal(err, boom);
});

test("a synchronous throw is routed to next(err)", async () => {
  const router = express.Router();
  const boom = new Error("sync boom");
  router.get("/sync", () => {
    throw boom;
  });

  const err = await callHandler(routeHandler(router, "/sync"));
  assert.equal(err, boom);
});

test("a handler that succeeds does not call next with an error", async () => {
  const router = express.Router();
  router.get("/ok", async () => {
    // resolves, sends nothing
  });

  const err = await callHandler(routeHandler(router, "/ok"));
  assert.equal(err, undefined);
});

test("wrapping keeps handler arity under 4 so Express still sees a plain handler", () => {
  const router = express.Router();
  router.get("/arity", (_req, _res, _next) => {});
  assert.ok(routeHandler(router, "/arity").length < 4);
});

test("4-arg error handlers are left alone, since Express identifies them by arity", () => {
  const router = express.Router();
  const errorHandler = (err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    next(err);
  };
  router.use(errorHandler);

  const stored = lastUseHandler(router);
  // Same function object, not a wrapper: arity 4 must survive exactly.
  assert.equal(stored, errorHandler as unknown as RequestHandler);
  assert.equal(stored.length, 4);
});

test("mounted sub-routers are left alone", () => {
  const parent = express.Router();
  const child = express.Router();
  parent.use(child);

  assert.equal(lastUseHandler(parent), child as unknown as RequestHandler);
});
