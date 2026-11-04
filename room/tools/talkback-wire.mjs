// Minimal TalkBack wire client over the LAN. Token + base URL from env so a
// Claude role (or the bridge) can talk to a host desk without a browser.
//   TALKBACK_URL    default http://127.0.0.1:8422
//   TALKBACK_TOKEN  a tb_ wire token issued for a desk (the FROM of send)

export function wireBase() {
  return (process.env.TALKBACK_URL || "http://127.0.0.1:8422").replace(/\/+$/, "");
}

function authHeaders(token) {
  const t = token || process.env.TALKBACK_TOKEN || "";
  if (!t) throw new Error("No wire token: set TALKBACK_TOKEN (a tb_… desk token).");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

export async function wireGet(op, params = {}, token) {
  const url = new URL(`${wireBase()}/api/wire/${op}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: authHeaders(token) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`wire ${op} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function wirePost(op, payload, token) {
  const res = await fetch(`${wireBase()}/api/wire/${op}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload ?? {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`wire ${op} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

/** Send a chat/nudge to a desk (or "all"). Returns the created message row. */
export function wireSay(to, text, kind = "chat", token) {
  return wirePost("send", { to: to === "all" ? null : to, kind, body: text }, token);
}

/** Read this desk's inbox since a cursor. Returns { cursor, messages, ... }. */
export function wireInbox(since = 0, token) {
  return wireGet("inbox", { since }, token);
}
