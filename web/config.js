// Public client config. The publishable key is browser-safe by design:
// RLS allows SELECT only (verified: writes return 401).
export const SUPABASE_URL = "https://kotcpqiajovkszzjeiov.supabase.co";
export const SUPABASE_KEY = "sb_publishable_ko2Qwn1DIlSnCukNkWudNw_TBVxEOhh";

// Writes go through the Netlify track function. During local dev the
// functions aren't served, so point at the deployed site.
export const FUNCTIONS_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "https://titotacomansfootballtracker.netlify.app/.netlify/functions"
    : "/.netlify/functions";
