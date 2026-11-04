import { SectionKicker } from "@/components/rack/mark";
import { Badge } from "@/components/ui/badge";
import { getAdmissions, getRecipes, useRackQuery } from "@/lib/rack/api";

export function RecipesView() {
  const recipes = useRackQuery(getRecipes, 20000);
  const admissions = useRackQuery(getAdmissions, 10000);
  const rows = recipes.data?.recipes ?? [];
  return (
    <div className="space-y-8">
      <section>
        <SectionKicker n="01">Recipes</SectionKicker>
        <p className="mt-2 text-sm text-muted-foreground">
          A recipe is a fixed, reviewed way to start work. Starting one only queues it; admission control decides when it runs.
          Add your own as a JSON file in the recipes folder.
        </p>
        <div className="mt-3 space-y-3">
          {recipes.error ? <p role="alert">Recipes unavailable.</p> : !recipes.data ? <p>Loading recipes...</p> : null}
          {rows.map((r) => (
            <div key={r.action} className="rounded-xl bg-card p-4 shadow-[var(--shadow-border)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={r.available ? "ok" : "hot"}>{r.available ? "available" : "unavailable"}</Badge>
                <p className="font-mono text-sm text-muted-foreground">{r.action} · up to {r.peak_gb} GB</p>
              </div>
              <p className="mt-1 text-sm font-medium text-foreground">{r.label}</p>
              {r.reason ? <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p> : null}
            </div>
          ))}
        </div>
      </section>
      <section>
        <SectionKicker n="02">Admission ledger</SectionKicker>
        <div className="mt-3 rounded-xl bg-card p-4 shadow-[var(--shadow-border)]">
          {admissions.error ? <p role="alert">Ledger unavailable.</p> : null}
          {admissions.data?.admissions.length ? (
            <ul className="space-y-1 break-words font-mono text-xs text-foreground">
              {admissions.data.admissions.map((a, i) => <li key={i}>{a.raw}</li>)}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No admission decisions yet.</p>}
        </div>
      </section>
    </div>
  );
}
