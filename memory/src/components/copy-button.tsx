import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyOrSave } from "@/lib/utils";

export function CopyButton({
  text,
  label = "Copy",
  filename = "somnus-copy.md",
}: {
  text: string;
  label?: string;
  filename?: string;
}) {
  const [done, setDone] = useState<"copied" | "saved" | false>(false);
  return (
    <Button
      size="sm"
      variant="outline"
      type="button"
      onClick={() => {
        void copyOrSave(filename, text).then((how) => {
          setDone(how);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done === "saved" ? "Saved file" : done === "copied" ? "Copied" : label}
    </Button>
  );
}