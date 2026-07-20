// Minimal Supabase REST (PostgREST) client over fetch — no SDK dependency.
// Server-side only: uses the service-role key, which bypasses RLS.
import { requireKey } from "./util.mjs";

function config() {
  return {
    url: requireKey("SUPABASE_URL"),
    key: requireKey("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

async function request(method, path, { params, body, prefer } = {}) {
  const { url, key } = config();
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetch(`${url}/rest/v1/${path}${qs}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

export const db = {
  select: (table, params) => request("GET", table, { params }),
  // Upsert on a unique column; returns the resulting rows (with ids).
  upsert: (table, rows, onConflict) =>
    request("POST", table, {
      params: { on_conflict: onConflict },
      body: rows,
      prefer: "resolution=merge-duplicates,return=representation",
    }),
  insert: (table, rows) =>
    request("POST", table, { body: rows, prefer: "return=representation" }),
  delete: (table, params) =>
    request("DELETE", table, { params, prefer: "return=representation" }),
};
