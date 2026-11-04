import { ActivityPanel } from "./activity-panel";
import { ControlsView } from "./controls-view";
import { JobsPanel } from "./jobs-panel";
import { RecipesView } from "./recipes-view";
import { RunStatus } from "./run-status";
import { SystemGauges } from "./system-gauges";
import { UnlockControls } from "./unlock-controls";
import { RackMark } from "@/components/rack/mark";
import { Badge } from "@/components/ui/badge";
import { getStatus, useRackQuery } from "@/lib/rack/api";
import { useRackStore } from "@/lib/rack/store";
import type { ViewId } from "@/lib/rack/types";
import { cn } from "@/lib/utils";
import { Activity, ScrollText, SlidersHorizontal, Terminal } from "lucide-react";

const NAV: { id: ViewId; label: string; icon: typeof Activity }[] = [
  { id: "jobs", label: "Jobs", icon: Activity },
  { id: "recipes", label: "Recipes", icon: ScrollText },
  { id: "controls", label: "Controls", icon: SlidersHorizontal },
  { id: "status", label: "Run status", icon: Terminal },
];

export function RackShell() {
  const view = useRackStore((s) => s.view);
  const setView = useRackStore((s) => s.setView);
  const { data: status, error } = useRackQuery(getStatus, 10000);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-52 flex-col border-r border-border bg-background lg:flex">
        <div className="flex items-center gap-2 px-5 py-6">
          <RackMark className="size-6" />
          <div>
            <p className="text-sm font-medium leading-none">Rack Community</p>
            <p className="mt-1 text-sm text-muted-foreground">Control panel</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavBtn key={item.id} {...item} active={view === item.id} onClick={() => setView(item.id)} />
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 lg:ml-52">
        <div className="flex items-center gap-2 lg:hidden">
          <RackMark className="size-5" />
          <span className="text-sm font-medium">Rack Community</span>
        </div>
        <div className="flex items-center gap-2">
          {error ? (
            <Badge variant="default">API unreachable</Badge>
          ) : (
            <>
              <Badge variant="default">{status?.live ? "LIVE" : "DRY-RUN"}</Badge>
              {status?.hold_present ? <Badge variant="sage">HOLD</Badge> : null}
            </>
          )}
        </div>
        <SystemGauges />
      </header>

      <main className="min-w-0 overflow-x-hidden px-4 py-6 pb-28 lg:ml-52 lg:px-8 lg:pb-12">
        <div className="mx-auto min-w-0 max-w-6xl">
          <UnlockControls />
          <ActivityPanel />
          <JobsPanel />
          {view === "recipes" ? <RecipesView /> : null}
          {view === "controls" ? <ControlsView /> : null}
          {view === "status" ? <RunStatus /> : null}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="flex overflow-x-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "flex min-w-24 min-h-14 shrink-0 flex-col items-center justify-center gap-1 text-sm",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function NavBtn({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: ViewId;
  label: string;
  icon: typeof Activity;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-[background-color,color] duration-150 ease-out",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
