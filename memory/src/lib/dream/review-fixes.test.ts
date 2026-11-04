/**
 * Reviewer one pass, Somnus main c1c2ba615 (27 Sep 2026): the pure halves of
 * the fixes. Each test fails on c1c2ba615 and passes with its fix.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { WEBHOOK_TARGET_WORDS, privateIpv4, privateIpv6, webhookTargetRefusal } from "./webhook-guard.ts";
import {
  IMPORT_ITEMS_MAX,
  KEY_TOO_LONG_WORDS,
  NOT_JSON_WORDS,
  PAYLOAD_TOO_BIG_WORDS,
  TEXT_MAX,
  USER_DATA_PAYLOAD_MAX,
  clampText,
  userDataRefusal,
} from "./limits.ts";

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// SO1 -- a report goes only to a public https address
test("a report webhook must be an https address on the public internet", () => {
  assert.equal(webhookTargetRefusal("https://hooks.slack.com/services/T0/B0/xyz"), null);
  assert.equal(webhookTargetRefusal("https://reports.example.com:8443/in"), null);
  for (const bad of [
    "",
    "internal:sink",
    "not a url",
    "http://hooks.slack.com/services/x",
    "https://user:pw@example.com/x",
    "https://localhost:3000/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.1/hook",
    "https://192.168.0.1/hook",
    "https://172.16.0.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/hook",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "https://internal-host/hook",
    "https://db.internal/hook",
    // Follow-up (coordinator, 27 Sep 2026): benchmark/testing, NAT64 and
    // deprecated site-local were reachable through the same door.
    "https://198.18.0.1/hook",
    "https://198.19.255.254/hook",
    "https://[64:ff9b::c000:221]/hook",
    "https://[fec0::1]/hook",
    "https://[feff::1]/hook",
  ]) {
    assert.equal(webhookTargetRefusal(bad), WEBHOOK_TARGET_WORDS, `${bad || "(empty)"} was allowed`);
  }
  const fns = src("src/lib/dream/control-fns.ts");
  const door = fns.slice(fns.indexOf("export const deliverWebhook"), fns.indexOf("export const bumpControlSession"));
  const pinnedIdx = door.indexOf("pinnedRequest(url");
  assert.ok(pinnedIdx > -1, "deliverWebhook no longer calls pinnedRequest -- the DNS-pin/redirect fix regressed");
  assert.ok(door.indexOf("webhookTargetRefusal(url)") < pinnedIdx, "the guard runs after the live send");
});

// SO2 -- records have a size
test("a user-data record is bounded in name, size and shape; an import is bounded in count", () => {
  assert.equal(userDataRefusal("memory", "file-1", JSON.stringify({ a: 1 })), null);
  assert.equal(userDataRefusal("", "file-1", "{}"), KEY_TOO_LONG_WORDS);
  assert.equal(userDataRefusal("memory", "k".repeat(201), "{}"), KEY_TOO_LONG_WORDS);
  assert.equal(userDataRefusal("memory", "file-1", 42), NOT_JSON_WORDS);
  assert.equal(userDataRefusal("memory", "file-1", "{not json"), NOT_JSON_WORDS);
  assert.equal(userDataRefusal("memory", "file-1", JSON.stringify("x".repeat(USER_DATA_PAYLOAD_MAX))), PAYLOAD_TOO_BIG_WORDS);
  assert.equal(clampText("x".repeat(TEXT_MAX + 5)).length, TEXT_MAX);
  assert.equal(clampText(null), "");
  assert.ok(IMPORT_ITEMS_MAX <= 1000);
  const ud = src("src/lib/dream/user-data-fns.ts");
  assert.equal(ud.split("userDataRefusal(").length - 1, 2, "put and import must both check each record");
  assert.ok(ud.includes("data.items.length > IMPORT_ITEMS_MAX"), "the import has no count cap");
  const fns = src("src/lib/dream/control-fns.ts");
  assert.ok(fns.includes("${clampText(j.detail)}") && fns.includes("${clampText(d.body)}"), "saveControl text is unbounded");
});

// SO1b -- coordinator follow-up, 27 Sep 2026: benchmark/testing, NAT64 and
// deprecated site-local were reachable through pushTargetRefusal-equivalent
// webhookTargetRefusal and the DNS pin alike.
test("privateIpv4 and privateIpv6 catch the RFC 2544, NAT64 and deprecated site-local ranges", () => {
  assert.equal(privateIpv4("198.18.0.0"), true, "198.18.0.0/15 low end");
  assert.equal(privateIpv4("198.19.255.255"), true, "198.18.0.0/15 high end");
  assert.equal(privateIpv4("198.17.255.255"), false, "one address below the range is untouched");
  assert.equal(privateIpv4("198.20.0.0"), false, "one address above the range is untouched");

  assert.equal(privateIpv6("64:ff9b::c000:221"), true, "NAT64 well-known prefix, compressed hex form");
  assert.equal(privateIpv6("64:ff9b::192.0.2.33"), true, "NAT64 well-known prefix, embedded dotted form");
  assert.equal(privateIpv6("64:ff9c::1"), false, "a different /32 is untouched");

  assert.equal(privateIpv6("fec0::1"), true, "fec0::/10 low end");
  assert.equal(privateIpv6("feff::1"), true, "fec0::/10 high end");
  assert.equal(privateIpv6("fe80::1"), true, "still caught, by the existing link-local check");
});
