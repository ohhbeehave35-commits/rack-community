import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { Pwa } from "@/components/pwa";
import { Shell } from "@/components/shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";

const APP_NAME = "Somnus";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        // viewport-fit=cover is what makes env(safe-area-inset-*) resolve to
        // anything but 0 on a notched phone; without it the bottom tab bar
        // sits under the home indicator.
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Control plane for gated agent memory. Dual control, precision floor, freeze, rollback, evidence pack.",
      },
      { name: "theme-color", content: "#0b0c0b" },
      // Installed-app behaviour. `mobile-web-app-capable` is the standard key;
      // the apple-prefixed one is still what iOS actually reads.
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "application-name", content: APP_NAME },
      // Stops iOS Safari turning ids, counts and timestamps into tel: links.
      { name: "format-detection", content: "telephone=no" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
          <TooltipProvider>
            <Shell>
              <Outlet />
            </Shell>
            <Pwa />
          </TooltipProvider>
        <Scripts />
      </body>
    </html>
  ),
});
