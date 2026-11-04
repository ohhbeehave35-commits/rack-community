import { Download, RefreshCw, Share, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Service-worker registration, update prompt, and install affordance.
 *
 * Three deliberate choices:
 *
 * 1. Registration is production-only. A service worker in front of Vite's dev
 *    server intercepts the HMR client and module graph, and the failure looks
 *    like "my edits stopped applying" rather than anything to do with caching.
 * 2. An update never applies itself. A silent `skipWaiting` swaps the bundle
 *    under a page the user is mid-way through, so the new worker sits in
 *    `waiting` until they accept.
 * 3. iOS is handled separately. Safari never fires `beforeinstallprompt`, so
 *    without its own branch the install path is simply invisible on iPhone and
 *    iPad, the platforms this most needs to work on.
 */

const DISMISS_KEY = "somnus.install.dismissed.v1";

function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari's non-standard flag, still the only signal on iOS.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

type Prompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function Pwa() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installEvent, setInstallEvent] = useState<Prompt | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const reloading = useRef(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // Private mode / blocked storage: show the prompt rather than hide it.
      setDismissed(false);
    }
  }, []);

  // --- registration + update detection -----------------------------------
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          // A worker that installs with no controller is the *first* one , 
          // that is a fresh install, not an update, and must not prompt.
          if (next.state === "installed" && navigator.serviceWorker.controller) {
            if (!cancelled) setWaiting(next);
          }
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        watch(reg);
        // Catch a worker that finished installing in a previous visit.
        void reg.update().catch(() => {});
      })
      .catch(() => {
        /* an unavailable worker must never break the app */
      });

    const onControllerChange = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  // --- install affordance -------------------------------------------------
  useEffect(() => {
    if (isStandalone()) return;

    const onPrompt = (e: Event) => {
      // Keep the event; Chrome only lets it be used once and only if we
      // preventDefault the mini-infobar first.
      e.preventDefault();
      setInstallEvent(e as Prompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const onInstalled = () => {
      setInstallEvent(null);
      setShowIosHint(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    if (isIos()) setShowIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to persist to; the banner just returns next visit */
    }
  };

  const applyUpdate = () => {
    waiting?.postMessage({ type: "SKIP_WAITING" });
    setWaiting(null);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === "dismissed") dismiss();
  };

  const showInstall = !dismissed && (installEvent !== null || showIosHint);
  if (!waiting && !showInstall) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-50 flex justify-center px-4",
        // Clear the mobile tab bar (h-14) and the home indicator; on lg the
        // bar is gone so it can sit lower.
        "bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] lg:bottom-[calc(env(safe-area-inset-bottom)+1rem)]",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        {waiting ? (
          <div className="flex items-center gap-3">
            <RefreshCw className="size-4 shrink-0 text-primary" strokeWidth={1.6} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">A new version is ready</p>
              <p className="truncate text-xs text-muted-foreground">
                Reload to pick it up. Nothing in progress is lost.
              </p>
            </div>
            <Button size="sm" onClick={applyUpdate} className="shrink-0">
              Reload
            </Button>
          </div>
        ) : installEvent ? (
          <div className="flex items-center gap-3">
            <Download className="size-4 shrink-0 text-primary" strokeWidth={1.6} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Install Somnus</p>
              <p className="truncate text-xs text-muted-foreground">
                Full screen, and it opens offline.
              </p>
            </div>
            <Button size="sm" onClick={() => void install()} className="shrink-0">
              Install
            </Button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" strokeWidth={1.6} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Share className="size-4 shrink-0 text-primary" strokeWidth={1.6} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Add Somnus to your Home Screen</p>
              <p className="text-xs text-muted-foreground">
                Tap Share, then “Add to Home Screen”.
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" strokeWidth={1.6} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
