// Claude gap-filler client (HANDOFF.md): fills in facts no free sports API
// provides. Currently: US broadcast listings for matches ESPN doesn't cover
// (e.g. Liga MX on ViX/TUDN). Settled/published facts only — never live
// in-match data.
//
// Model is configurable via ANTHROPIC_MODEL (default claude-opus-4-8). Uses
// the web_search server tool. This is the only paid component in the project.
import Anthropic from "@anthropic-ai/sdk";
import { requireKey } from "./util.mjs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: requireKey("ANTHROPIC_API_KEY") });
  return client;
}

// Pull the last JSON object out of the model's text.
function extractJson(text) {
  const matches = text.match(/\{[\s\S]*?\}/g);
  if (!matches) return null;
  for (const m of matches.reverse()) {
    try { return JSON.parse(m); } catch { /* keep looking */ }
  }
  return null;
}

// Returns { broadcast: string|null, confidence: "high"|"medium"|"low" } or null.
export async function lookupBroadcast({ home, away, league, dateISO }) {
  const date = new Date(dateISO).toISOString().slice(0, 10);
  const prompt =
    `Where can I watch the soccer match ${home} vs ${away} in the ${league} on ${date}, in the United States? ` +
    `Search the web for the official US broadcaster or streaming service for this specific match. ` +
    `Consider services such as ViX, TUDN, Univision, UniMás, Telemundo, Peacock, Fox Sports 1, FS2, Fox Deportes, Apple TV, ESPN+, Paramount+, CBS, USA Network, and others. ` +
    `If sources disagree or you can't confirm the specific match, say so with lower confidence. ` +
    `Reply with ONLY a JSON object as the final line and nothing after it: ` +
    `{"broadcast": "<comma-separated US services, or null if you cannot determine it>", "confidence": "high" | "medium" | "low"}. ` +
    `Use short service names (e.g. "ViX", "TUDN", "Fox Sports 1").`;

  let messages = [{ role: "user", content: prompt }];
  let res;
  for (let i = 0; i < 4; i++) {
    res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages,
    });
    // Server-side web search may pause; resume by echoing the turn back.
    if (res.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: res.content }];
      continue;
    }
    break;
  }

  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) return null;

  const raw = parsed.broadcast;
  const broadcast =
    raw && String(raw).trim() && String(raw).trim().toLowerCase() !== "null"
      ? String(raw).trim().slice(0, 120)
      : null;
  const confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low";
  return { broadcast, confidence };
}
