/**
 * Reviewer one pass, 27 Sep 2026: a report webhook is a server-side POST to
 * an address the account's policy names. It goes only to an https address
 * on the public internet: never plain http, never localhost, a private
 * range, a link-local or cloud-metadata address, a single-label host or a
 * placeholder. Pure, so the test needs no server.
 *
 * Follow-up, 27 Sep 2026 (PRELAND-READ-somnus-rv-f218a67f-0632ET.md, SO1b),
 * ported from Live Call Assist's L2b/L2c fix: this literal-hostname check
 * alone is not enough -- a public hostname can RESOLVE to a private address
 * (127.0.0.1.nip.io, localtest.me), and deliverWebhook's plain fetch followed
 * any redirect. See pinned-fetch.server.ts for the DNS-pin and redirect fix,
 * which reuses privateIpv4/privateIpv6 below against the resolved address,
 * not just the literal host. Also added here: the benchmark/testing
 * (198.18.0.0/15), NAT64 (64:ff9b::/96) and deprecated site-local
 * (fec0::/10) ranges, closed in Live Call Assist the same day.
 */
export const WEBHOOK_TARGET_WORDS = "The report address must be an https address on the public internet. Nothing was sent.";

const PRIVATE_HOST = /^(localhost|.*\.(localhost|local|internal|invalid|test|example|home|lan))$/i;

export function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark-testing, RFC 2544
  if (a >= 224) return true;
  return false;
}

export function privateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (/^f[cd]/.test(h)) return true; // unique local
  if (/^fe[89ab]/.test(h)) return true; // link local
  if (/^fe[c-f]/.test(h)) return true; // site local, deprecated RFC 3879 (fec0::/10)
  if (/^64:ff9b:(0:0:0:0:|:)/.test(h)) return true; // NAT64 well-known prefix (64:ff9b::/96)
  if (h.startsWith("::ffff:")) {
    const rest = h.slice(7);
    if (rest.includes(".")) return privateIpv4(rest);
    const [hi, lo] = rest.split(":").map((g) => parseInt(g || "0", 16));
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return true;
    return privateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

/** Plain words when `raw` is not a public https address, else null. */
export function webhookTargetRefusal(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return WEBHOOK_TARGET_WORDS;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return WEBHOOK_TARGET_WORDS;
  }
  if (url.protocol !== "https:") return WEBHOOK_TARGET_WORDS;
  if (url.username || url.password) return WEBHOOK_TARGET_WORDS;
  const host = url.hostname;
  if (!host || PRIVATE_HOST.test(host)) return WEBHOOK_TARGET_WORDS;
  if (host.startsWith("[") || host.includes(":")) return privateIpv6(host) ? WEBHOOK_TARGET_WORDS : null;
  if (privateIpv4(host)) return WEBHOOK_TARGET_WORDS;
  if (!host.includes(".")) return WEBHOOK_TARGET_WORDS;
  return null;
}
