import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { envSchema, storageEnvSchema } from "../dist/config/env.schema.js";

const envExamplePath = new URL("../.env.example", import.meta.url);

// Storage keys live in their own schema so a missing Garage does not stop login.
const schemaKeys = [...Object.keys(envSchema.shape), ...Object.keys(storageEnvSchema.shape)].sort();
const fileKeys = Object.keys(parse(readFileSync(envExamplePath))).sort();

const missing = schemaKeys.filter((k) => !fileKeys.includes(k));
const extra = fileKeys.filter((k) => !schemaKeys.includes(k));

if (missing.length || extra.length) {
  if (missing.length) console.error(`✗ Missing in .env.example: ${missing.join(", ")}`);
  if (extra.length) console.error(`✗ Extra in .env.example (missing in schema): ${extra.join(", ")}`);
  process.exit(1);
}
console.log(`✓ .env.example synchronized with schema (${schemaKeys.length} variables)`);
