import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";
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
