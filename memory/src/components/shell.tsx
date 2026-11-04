import { Link, Navigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BookMarked,
  Compass,
  LifeBuoy,
  Menu,
  Moon,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadControl } from "@/lib/dream/control-fns";
import { INTRO_PATH, readIntroDone, shouldRedirectToIntro } from "@/lib/dream/intro-status";
import { ORG, ROLES, can } from "@/lib/dream/org";
import { fmtMb, heapTone, useRam } from "@/lib/dream/ram";
import { stampShort } from "@/lib/dream/stamp";
import { markDreamHydrated, isDreamPersistHydrated, useDream } from "@/lib/dream/store";
import type { Role } from "@/lib/dream/types";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/simple", label: "Simple", icon: Sparkles },
  { to: "/", label: "Dream", icon: Moon },
  { to: "/claude", label: "Assistant", icon: Activity },
  { to: "/memory", label: "Memory", icon: BookMarked },
  { to: "/gate", label: "Gate", icon: ShieldCheck },
  { to: "/program", label: "Jobs", icon: Timer },
  { to: "/audit", label: "Audit", icon: ScrollText },
  { to: "/tour", label: "Tour", icon: Compass },
] as const;

/** The phone bar holds four; everything else sits one tap away under More.
 *  (It used to put 7 items in a 6-column grid, so Audit fell off the bar.) */
const PHONE_BAR = ["/simple", "/memory", "/gate", "/program"] as const;

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    window.scrollTo({ top: 0 });
    return;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--header-h")
    .trim();
  const headerH = Number.parseFloat(raw) || 112;
  const y = el.getBoundingClientRect().top + window.scrollY - headerH - 8;
  window.scrollTo({ top: Math.max(0, y) });
}

/** Routes that render bare: no chrome, no control-plane hydration. None at present. */
const PUBLIC_PATHS = new Set<string>();

/**
 * BUNDLER LANDMINE, recorded here because it costs a day to rediscover.
 *
 * One more module importing from the SSR entry makes this Nitro/rolldown beta
 * split that entry chunk in two, and the split emits a facade (`_ssr/ssr.mjs`,
 * ~15 lines) that re-exports an `ssr_exports` binding it never defines while
 * the real code moves to `ssr2.mjs`. That is an ESM link error, so EVERY route
 * in the built output answers 500 with `SyntaxError: Export 'ssr_exports' is
 * not defined in module`, on Vercel exactly as under `npm run preview`.
 * Meanwhile `npm run build` exits 0 and typecheck, lint and the test suite all
 * stay green, so nothing else catches it.
 *
 * Two triggers found while adding a route, each reproduced on
 * its own from a clean build:
 *
 *   1. A NEW ROUTE MODULE that imports `Link` from `@tanstack/react-router`.
 *      A four-line route whose only content is one `<Link>` does it. This file
 *      already imports `Link`, so the chrome below is unaffected, hence
 *      other pages navigate with plain `<a href>`.
 *   2. A SECOND MODULE calling `createServerFn`. Hence the account handlers
 *      live at the bottom of `@/lib/dream/control-fns` and `@/lib/account/api`
 *      only re-exports them.
 *
 * After any build that adds a route or a server function: check whether
 * `_ssr/` holds one file or a facade plus `ssr2.mjs`, then `npm run preview`
 * and load `/`. Do not trust a green build on its own.
 */

/**
 * Session gate for the whole app.
 *
 * Everything Somnus shows, daemon state, policy, jobs, the audit trail, is
 * per-user data behind `authMiddleware`, so the chrome only mounts for a signed-in
 * visitor. `PUBLIC_PATHS` render bare. Gate on `isPending`, never on `user`
 * alone, or a hard reload bounces a signed-in owner back to sign-in.
 */
/**
 * `null` means "not read yet" (first client render, before the effect below
 * runs): rendered as the same skeleton as a pending session so a first-time
 * visitor never flashes the app shell before bouncing to `/intro`.
 */
function useIntroDone(): boolean | null {
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => setDone(readIntroDone()), []);
  return done;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isPending } = useCurrentUserState();
  const introDone = useIntroDone();

  if (PUBLIC_PATHS.has(pathname)) return <>{children}</>;
  if (isPending) return <ShellSkeleton />;
  // `/intro` itself always renders bare and immediately, the same as House's
  // `if (path === "/intro") return <Outlet />;`: it must not wait on the
  // localStorage read below (that read is what decides whether to send OTHER
  // routes here in the first place, and would otherwise flash a skeleton on
  // the one route a first-time visitor is guaranteed to land on).
  if (pathname === INTRO_PATH) return <>{children}</>;
  if (introDone === null) return <ShellSkeleton />;
  if (shouldRedirectToIntro(pathname, introDone)) return <Navigate to={INTRO_PATH} />;
  return <AppShell>{children}</AppShell>;
}

/** Same-sized placeholder while the session resolves, one clean swap, no flash. */
function ShellSkeleton() {
  return (
    <div className="grain min-h-dvh bg-background">
      <div className="h-14 border-b border-border/80 sm:h-16" />
      <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
        <div className="h-6 w-40 animate-pulse rounded-md bg-foreground/10" />
      </div>
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const { pathname, hash } = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      hash: s.location.hash,
    }),
  });
  const {
    lastDream,
    running,
    runDream,
    waitingCount,
    armed,
    role,
    setSeat,
    frozen,
  } = useDream();
  const canRun = can(role, "run") && !frozen && !running;
  const { sample } = useRam();
  const ramTone = heapTone(sample);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const sync = () => {
      document.documentElement.style.setProperty(
        "--header-h",
        `${el.offsetHeight}px`,
      );
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const target = (hash || "").replace(/^#/, "");
      if (target) scrollToId(target);
      else window.scrollTo(0, 0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pathname, hash]);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    const autoLock = () => {
      if (!isDreamPersistHydrated()) return;
      useDream.getState().lockProject("Latest dream", { silent: true, kind: "auto" });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") useDream.getState().tick();
      else autoLock();
    };
    const onFocus = () => useDream.getState().tick();
    void Promise.resolve(useDream.persist.rehydrate()).then(async () => {
      markDreamHydrated();
      if (cancelled) return;
      try {
        const plane = await loadControl();
        useDream.getState().hydrateControl(plane);
      } catch {
        /* first request also applies migrations */
      }
      if (cancelled) return;
      try {
        const { syncOnLogin } = await import("@/lib/dream/sync");
        const synced = await syncOnLogin();
        if (synced && !cancelled) {
          const s = useDream.getState();
          const merged = {
            lockedProjects: mergeByKey(s.lockedProjects ?? [], synced.lockedProjects, "id"),
            snapshots: mergeByKey(s.snapshots, synced.snapshots, "at"),
            reports: mergeByKey(s.reports, synced.reports, "at"),
            logs: mergeByKey(s.logs, synced.logs, "at"),
          };
          useDream.setState(merged);
        }
      } catch {
        /* sync failure is non-fatal, local state works offline */
      }
      if (cancelled) return;
      useDream.getState().tick();
      interval = window.setInterval(() => {
        useDream.getState().tick();
      }, 1000);
    });
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", autoLock);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", autoLock);
    };
  }, []);

  return (
    <div className="grain relative min-h-dvh bg-background text-foreground">
      <header
        ref={headerRef}
        className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-sm"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full border border-primary/40 text-primary">
              <Moon className="size-3.5" strokeWidth={1.6} />
            </span>
            <span className="font-display text-lg tracking-tight">Somnus</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-0.5 xl:flex">
            {NAV.map((item) => {
              const active =
                item.to === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "rounded-md px-2 py-2 text-sm transition-colors duration-150",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Tooltip
              content={
                frozen
                  ? "Writes are frozen. Admin must lift the freeze."
                  : can(role, "run")
                    ? "Run a full dream as this role."
                    : "Reviewer cannot write memory."
              }
            >
              <Button
                size="sm"
                onClick={() => runDream()}
                disabled={!canRun}
                className="min-w-24"
              >
                {running ? "Dreaming…" : "Run dream"}
              </Button>
            </Tooltip>
            <div className="hidden items-center gap-3 whitespace-nowrap sm:flex">
              <UserButton />
            </div>
          </div>
        </div>
        <div className="border-t border-border/60">
          {/* Scrolls rather than clips: on a 375px phone the role switcher is
              the last child and `overflow-hidden` simply cut it off screen. */}
          <div className="no-scrollbar mx-auto flex max-w-6xl items-center gap-x-3 overflow-x-auto overflow-y-hidden whitespace-nowrap px-4 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground sm:px-6">
            {/* Phone/TWA: the top row has no space for the identity chip, so
                the owner label sits at the head of this strip, visible without having
                to scroll the strip sideways. */}
            <div className="flex shrink-0 items-center gap-3 normal-case tracking-normal sm:hidden">
              <UserButton />
            </div>
            <span className="pointer-events-none hidden shrink-0 sm:inline">
              {ORG.name}
            </span>
            <span className="pointer-events-none hidden text-border sm:inline">/</span>
            <span className="pointer-events-none hidden shrink-0 sm:inline">
              {ORG.project}
            </span>
            <Badge
              variant="outline"
              className="pointer-events-none shrink-0 whitespace-nowrap normal-case tracking-normal"
            >
              this tab · catch-up
            </Badge>
            {armed ? (
              <Badge variant="ok" className="pointer-events-none shrink-0">
                armed
              </Badge>
            ) : null}
            {frozen ? (
              <Badge variant="danger" className="pointer-events-none shrink-0">frozen</Badge>
            ) : (
              <Badge variant="muted" className="pointer-events-none shrink-0">live</Badge>
            )}
            {sample?.usedMb != null ? (
              <Link
                to="/"
                hash="ram"
                className="inline-flex shrink-0"
                onClick={(e) => {
                  if (pathname === "/" && (hash || "") === "#ram") {
                    e.preventDefault();
                    scrollToId("ram");
                  }
                }}
              >
                <Badge
                  variant={
                    ramTone === "ok"
                      ? "ok"
                      : ramTone === "warn"
                        ? "warn"
                        : ramTone === "danger"
                          ? "danger"
                          : "outline"
                  }
                  className="normal-case tracking-normal"
                >
                  heap {fmtMb(sample.usedMb)}
                </Badge>
              </Link>
            ) : (
              <Link
                to="/"
                hash="crash"
                className="inline-flex shrink-0"
                onClick={(e) => {
                  if (pathname === "/" && (hash || "") === "#crash") {
                    e.preventDefault();
                    scrollToId("crash");
                  }
                }}
              >
                <Badge variant="outline" className="normal-case tracking-normal">
                  RAM
                </Badge>
              </Link>
            )}
            <div className="flex shrink-0 items-center gap-1">
              {ROLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSeat(s.id as Role)}
                  className={cn(
                    "h-7 min-w-11 rounded-sm px-1.5 text-xs uppercase",
                    role === s.id ? "bg-accent text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label.slice(0, 3)}
                </button>
              ))}
            </div>
            <span className="pointer-events-none ml-auto hidden min-w-0 truncate normal-case tracking-normal lg:inline">
              last dream {stampShort(lastDream)}
              {waitingCount > 0 ? ` · ${waitingCount} waiting` : ""}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 sm:pt-10 xl:pb-16">
        {children}
      </main>

      <PhoneNav pathname={pathname} />
    </div>
  );
}

function isActive(to: string, pathname: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

function PhoneNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const bar = NAV.filter((n) => (PHONE_BAR as readonly string[]).includes(n.to));
  const more = NAV.filter((n) => !(PHONE_BAR as readonly string[]).includes(n.to));
  const moreActive = more.some((n) => isActive(n.to, pathname));
  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-background/60 xl:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      ) : null}
      {open ? (
        <div
          id="phone-more"
          role="dialog"
          aria-label="More screens"
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 max-h-[70vh] overflow-y-auto border-t border-border bg-background px-3 py-3 xl:hidden"
        >
          <ul className="grid grid-cols-2 gap-2">
            {[...more, { to: "/lab", label: "Lab", icon: Sparkles }].map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-12 items-center gap-2 rounded-md border border-border px-3 text-base",
                      isActive(item.to, pathname) ? "bg-accent text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.6} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <nav data-assistant-avoid className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md xl:hidden" aria-label="Main">
        <ul className="grid grid-cols-5">
          {bar.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-1 text-xs",
                    isActive(item.to, pathname) ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.6} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="phone-more"
              onClick={() => setOpen((v) => !v)}
              className={cn(
                "flex h-14 w-full flex-col items-center justify-center gap-1 text-xs",
                open || moreActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Menu className="size-5" strokeWidth={1.6} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function mergeByKey<T>(
  local: T[],
  server: T[],
  keyField: string,
): T[] {
  const map = new Map<unknown, T>();
  for (const item of local) map.set((item as Record<string, unknown>)[keyField], item);
  for (const item of server) map.set((item as Record<string, unknown>)[keyField], item);
  return Array.from(map.values());
}