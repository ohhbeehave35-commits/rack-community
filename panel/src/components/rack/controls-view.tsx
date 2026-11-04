import { useState } from "react";
import { TypedConfirmButton } from "./typed-confirm";
import { SectionKicker } from "@/components/rack/mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { act, getActions, getLive, getRecipes, previewStart, setLive, useRackQuery } from "@/lib/rack/api";

/** Every button here sends ONE request to the Rack API, which only queues it. This screen never launches a process:
 * the actor (rack_actor.py) is the only thing that does, and only through admission control. */

const WHO = "owner"; // the one operator this control panel is for.

export function ControlsView() {
  const { data: live, error: liveErr, loading: liveLoading } = useRackQuery(getLive, 8000);
  const { data: actionsData } = useRackQuery(() => getActions(5), 8000);
  const { data: recipeData, error: recipeErr } = useRackQuery(getRecipes, 30000);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [recipe, setRecipe] = useState("");
  const [check, setCheck] = useState<string | null>(null);
  const recipes = (recipeData?.recipes ?? []).filter((r) => r.available);
  const isLive = live?.live ?? false;

  async function doAct(action: string, params: Record<string, unknown>, label: string) {
    setBusy(true);
    setLastResult(null);
    try {
      const res = await act(action, params, WHO);
      setLastResult(`${label}: sent (${res.job_id}). Saved progress appears in Right now.`);
    } catch (e) {
      setLastResult(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLive() {
    const next = !isLive;
    const sentence = next
      ? "Turn controls LIVE: from now on, starts, stops and pauses really change what runs, not just log what would happen."
      : "Turn controls back to DRY-RUN: nothing you click will change anything until you flip this back on.";
    if (!window.confirm(sentence)) return;
    setBusy(true);
    try {
      await setLive(next, WHO);
      setLastResult(next ? "Controls are now LIVE." : "Controls are back to DRY-RUN.");
    } catch (e) {
      setLastResult(`Could not flip the switch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionKicker n="00">Controls</SectionKicker>
        <div className="mt-3 space-y-4 rounded-xl bg-card p-4 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-center gap-3">
            {liveLoading ? (
              <Badge variant="default">…</Badge>
            ) : liveErr ? (
              <Badge variant="default">status unknown</Badge>
            ) : isLive ? (
              <Badge variant="ok">LIVE: actions really happen</Badge>
            ) : (
              <Badge variant="sage">DRY-RUN: actions only log what would happen</Badge>
            )}
            <Button variant="outline" size="sm" disabled={busy || liveLoading} onClick={toggleLive}>
              {isLive ? "Switch to dry-run" : "Switch to LIVE"}
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto">
              <span className="text-muted-foreground">Recipe to start</span>
              <select
                className="w-full max-w-full rounded-md border border-border bg-background px-2 py-1 text-sm sm:w-auto"
                value={recipe}
                onChange={(e) => { setRecipe(e.target.value); setCheck(null); }}
              >
                <option value="">Choose a recipe…</option>
                {recipes.map((r) => (
                  <option key={r.action} value={r.action}>{r.action}: {r.label}</option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !recipe}
              onClick={async () => {
                setCheck("Checking the memory budget…");
                try {
                  const r = await previewStart(recipe);
                  setCheck(`${r.admitted ? "Fits now" : "Would wait"}: ${r.verdict}`);
                } catch (e) {
                  setCheck(`Could not check: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            >
              Check it fits
            </Button>
            <TypedConfirmButton
              label="Start"
              disabled={busy || !recipe}
              sentence={`This will ${isLive ? `queue ${recipe}; admission control still decides when it runs` : `log what starting ${recipe} would do, without starting anything`}. Continue?`}
              onConfirmed={() => doAct(recipe, {}, "Start")}
            />
          </div>
          {recipeErr ? <p className="text-sm text-hot">Could not load recipes: {recipeErr}</p> : null}
          {check ? <p className="text-sm text-foreground">{check}</p> : null}
          {lastResult ? <p className="text-sm text-foreground">{lastResult}</p> : null}
        </div>
      </section>

      <section>
        <SectionKicker n="01">Last actions</SectionKicker>
        <div className="mt-3 rounded-xl bg-card p-4 shadow-[var(--shadow-border)]">
          {actionsData?.rows.length ? (
            <ul className="space-y-1 break-words font-mono text-xs text-foreground">
              {actionsData.rows.map((row, i) => (
                <li key={i}>{row}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No actions recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
