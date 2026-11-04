# TalkBack voice relay

A small relay for huddle audio. It does two jobs in one process:

- **Signalling.** `/ws` accepts `{type:"join",company,callId,peer,name}` and then `{type:"signal",to,kind,payload}`
  (`offer`, `answer`, `ice`). An absent `to` broadcasts only inside that room. Sender ids come from the socket,
  membership is memory-only and removed on disconnect, and no SDP, ICE, audio or keys are logged or stored.
- **TURN.** `GET /ice` returns STUN and UDP TURN addresses with a ten-minute username and an HMAC-SHA1 password
  (the TURN REST convention). The same process runs `node-turn` 0.0.6 and checks credentials on demand, including
  expiry, with no credential database. `GET /healthz` reports ready once both listeners are up.

## Run it

Node 22 or later is required. There is no native build.

```
cd relay
npm ci --ignore-scripts
TURN_SHARED_KEY=<a long random value> node server.mjs
```

Settings (environment variables; keep real values out of source, shell history and logs):

| Variable | Default | Meaning |
| --- | --- | --- |
| `TURN_SHARED_KEY` | none, required | Shared key the TURN credentials are derived from. Startup is refused without it. |
| `RELAY_PORT` | 8787 | HTTP and WebSocket port. |
| `TURN_PUBLIC_HOST` | loopback | Public IPv4 address or DNS-only hostname that callers can reach. |
| `TURN_PORT` | 3478 | TURN UDP port. |
| `TURN_REALM` | talkback | TURN realm. |
| `CF_TURN_KEY_ID`, `CF_TURN_KEY_TOKEN` | unset | Optional. With both set, `/ice` returns Cloudflare TURN credentials first and your own TURN as the fallback. |

When you build TalkBack, set `VITE_TALKBACK_RELAY_URL` to the HTTPS base URL of the relay. If it is unset, huddles use the
existing roll-call behaviour and the peer-to-peer transport.

## Security

The relay isolates rooms but does **not** authenticate company claims and does not restrict `/ice`. Put it behind your own
access boundary. A public, unprotected endpoint lets anyone who knows a room id join it, and lets anyone obtain temporary
TURN credentials.

## Tests

From the repository root: `node --experimental-strip-types --test relay/relay.test.ts`. Local tests are not proof of a
two-network voice call. Real UDP reachability and two-browser audio need to be checked on your own network.
