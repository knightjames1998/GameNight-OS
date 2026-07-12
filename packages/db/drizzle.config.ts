import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Replit provides DATABASE_URL for its built-in Postgres.
    url: process.env.DATABASE_URL!,
  },
});
