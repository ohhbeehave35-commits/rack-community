import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameSiteFetch } from "./middleware.ts";

test("same-origin and user-initiated requests are served", () => {
  assert.equal(isSameSiteFetch("same-origin"), true);
  assert.equal(isSameSiteFetch("none"), true);
});

test("a request with no Sec-Fetch-Site header (curl, tests) is served", () => {
  assert.equal(isSameSiteFetch(null), true);
  assert.equal(isSameSiteFetch(undefined), true);
  assert.equal(isSameSiteFetch(""), true);
});

test("requests started by another site or a sibling subdomain are refused", () => {
  assert.equal(isSameSiteFetch("cross-site"), false);
  assert.equal(isSameSiteFetch("same-site"), false);
});
