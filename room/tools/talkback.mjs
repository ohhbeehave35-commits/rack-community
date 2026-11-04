#!/usr/bin/env node
// `talkback` CLI — talk to a TalkBack host desk over the LAN with a wire token,
// so a Claude role can read Bot's drops and answer without a browser.
//
//   TALKBACK_URL=http://<host>:8422 TALKBACK_TOKEN=tb_… \
//   node tools/talkback.mjs say <to|all> "<text>"
//   node tools/talkback.mjs read [--since N]
//   node tools/talkback.mjs snapshot
//
// <to> is the recipient desk (lead|builder|reviewer|all); the sender is the
// desk the token was issued for.
import { wireSay, wireInbox, wireGet, wireBase } from "./talkback-wire.mjs";

function usage(code = 1) {
  process.stderr.write(
    "usage: talkback say <to|all> \"<text>\" | talkback read [--since N] | talkback snapshot\n",
  );
  process.exit(code);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "say") {
    const to = rest[0];
    const text = rest.slice(1).join(" ").trim();
    if (!to || !text) usage();
    const row = await wireSay(to, text);
    console.log(`sent #${row.id} -> ${row.to ?? "all"} (${wireBase()})`);
  } else if (cmd === "read") {
    const i = rest.indexOf("--since");
    const since = i >= 0 ? Number(rest[i + 1] || 0) : 0;
    const { cursor, messages } = await wireInbox(since);
    for (const m of messages) console.log(`#${m.id} ${m.at} ${m.from}->${m.to ?? "all"} [${m.kind}] ${m.body}`);
    console.log(`-- cursor ${cursor} (${messages.length} msg)`);
  } else if (cmd === "snapshot") {
    const snap = await wireGet("snapshot");
    console.log(JSON.stringify(snap, null, 2));
  } else {
    usage(cmd ? 1 : 0);
  }
} catch (e) {
  process.stderr.write(`talkback: ${e.message}\n`);
  process.exit(1);
}
