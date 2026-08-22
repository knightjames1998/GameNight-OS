import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";
// Query operators re-exported so consumers never import drizzle-orm directly;
// everything database flows through this package.
export { eq, ne, and, or, not, gt, gte, lt, lte, isNull, isNotNull, inArray, desc, asc, sql } from "drizzle-orm";
// A SELF-JOIN needs the same table twice under two names, which is what
// `alias` is for. Re-exported here for the same reason the operators above
// are: partner stats join match_participants to itself to find the other
// people on your side of a match, and reaching past this package for it
// would be the first consumer importing drizzle-orm directly.
export { alias } from "drizzle-orm/pg-core";

export { schema };

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Lazy singleton so importing the package doesn't require DATABASE_URL
 * (lets typecheck and tooling run without a live database).
 */
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    const pool = new pg.Pool({ connectionString: url });
    _db = drizzle(pool, { schema });
  }
  return _db;
}
