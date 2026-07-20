import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Minimal .env loader — no dependency needed.
export function loadEnv() {
  try {
    const text = readFileSync(join(projectRoot, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env yet — scripts will report which key is missing
  }
}

export function requireKey(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

// Save a raw provider payload under samples/<provider>/<name>.json.
// These files are the source of truth for designing the normalized schema.
export function saveSample(provider, name, data) {
  const dir = join(projectRoot, "samples", provider);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  saved samples/${provider}/${name}.json`);
}

export async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body };
}
