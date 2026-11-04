import { createMiddleware } from "@tanstack/react-start";

/**
 * Rack Community runs as a single-owner, self-hosted app: there is no sign-in
 * screen. Everything is stored under one fixed local owner id, and the server
 * is meant to listen on 127.0.0.1 (or sit behind your own access boundary).
 *
 * The one thing this middleware does check is where a request came from: a
 * browser tells the server whether a request was started by a page on another
 * site (`Sec-Fetch-Site`), and those are refused, so a web page you happen to
 * have open cannot drive the control plane on your behalf.
 */
export const LOCAL_OWNER_ID = "local-owner";

export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Cross-site request refused");
    this.name = "CrossSiteRequestError";
  }
}

/** True for a request that is safe to serve: same origin, user-initiated, or not from a browser. */
export function isSameSiteFetch(secFetchSite: string | null | undefined): boolean {
  if (!secFetchSite) return true; // curl, tests, older clients
  return secFetchSite === "same-origin" || secFetchSite === "none";
}

export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    if (request && !isSameSiteFetch(request.headers.get("sec-fetch-site"))) {
      throw new CrossSiteRequestError();
    }
    return next({ context: { userId: LOCAL_OWNER_ID, userEmail: null as string | null } });
  },
);
