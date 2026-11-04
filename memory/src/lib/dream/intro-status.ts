/**
 * First-run walkthrough flag, `localStorage` only (same pattern as `tour.tsx`'s
 * own `KEY`; no server round trip needed for a purely-local "have I seen this"
 * bit). `shouldRedirectToIntro` is the guard `shell.tsx` calls: a `pathname`
 * check pulled out as a pure function so it can be unit-tested without
 * mounting React or a router.
 */
export const INTRO_KEY = "somnus-intro-done-v1";
export const INTRO_PATH = "/intro";

export function readIntroDone(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    // Storage blocked: never trap a visitor in a redirect loop they cannot escape.
    return true;
  }
}

export function markIntroDone(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* best-effort; the in-memory step state already advanced this visit */
  }
}

/** A first-time signed-in visitor on any route but `/intro` itself gets sent there. */
export function shouldRedirectToIntro(pathname: string, introDone: boolean): boolean {
  return !introDone && pathname !== INTRO_PATH;
}
