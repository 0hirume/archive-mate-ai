import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) {
    loadEnvFile(".env");
}

export const catalogPath = resolve(process.env.CATALOG_PATH || "data/catalog.sqlite");
export const model = process.env.GEMINI_MODEL?.trim() || null;
export const assistanceConfigured = Boolean(process.env.GEMINI_API_KEY?.trim() && model);
