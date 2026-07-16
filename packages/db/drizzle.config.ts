import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // DATABASE_URL is set in the Render service env (points at Neon).
    url: process.env.DATABASE_URL!,
  },
});
