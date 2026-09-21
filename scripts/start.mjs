import { resolve } from "node:path";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), false);
process.env.DATABASE_PATH = resolve(
  process.env.DATABASE_PATH || "data/apply.db",
);
process.env.HOSTNAME = "0.0.0.0";
await import("../.next/standalone/server.js");
