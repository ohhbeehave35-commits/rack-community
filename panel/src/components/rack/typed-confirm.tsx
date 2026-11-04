import { useState } from "react";
import { Button } from "@/components/ui/button";
import { START_WORD, typedWordOk } from "@/lib/rack/status-stream";

/** Starting work asks the person to type the word, not just tap OK. The queue and the admission check still decide when it runs. */
export function TypedConfirmButton({
  label, sentence, word = START_WORD, disabled, onConfirmed,
}: {
  label: string; sentence: string; word?: string; disabled?: boolean; onConfirmed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open) {
    return <Button disabled={disabled} onClick={() => setOpen(true)} data-testid="typed-open">{label}</Button>;
  }
  const ok = typedWordOk(typed, word);
  const close = () => { setOpen(false); setTyped(""); };
  return (
    <div role="group" aria-label={label} className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4" data-testid="typed-panel">
      <p className="text-sm">{sentence}</p>
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Type {word} to confirm</span>
        <input
          autoFocus
          className="w-full max-w-full rounded-md border border-border bg-background px-2 py-1 text-sm sm:w-48"
          value={typed}
          maxLength={12}
          aria-label={`Type ${word} to confirm`}
          onChange={(e) => setTyped(e.target.value)}
          data-testid="typed-input"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!ok || disabled} onClick={() => { close(); onConfirmed(); }} data-testid="typed-confirm">{label}</Button>
        <Button variant="secondary" onClick={close} data-testid="typed-cancel">Cancel</Button>
      </div>
    </div>
  );
}
