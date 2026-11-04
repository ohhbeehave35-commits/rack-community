import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function triggerDownload(filename: string, blob: Blob) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadText(filename: string, contents: string) {
  triggerDownload(
    filename,
    new Blob([contents], { type: "text/markdown;charset=utf-8" }),
  );
}

export function downloadBlob(filename: string, blob: Blob) {
  triggerDownload(filename, blob);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* insecure context, permission, or missing API */
  }
  return false;
}

export async function copyOrSave(
  filename: string,
  text: string,
): Promise<"copied" | "saved"> {
  if (await copyText(text)) return "copied";
  downloadText(filename, text);
  return "saved";
}

export async function shareOrCopy(
  title: string,
  filename: string,
  text: string,
): Promise<"shared" | "copied" | "saved"> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text });
      return "shared";
    }
  } catch (err) {
    /* User dismissed the share sheet, still hand them the pack. */
    if (!(err instanceof Error && err.name === "AbortError")) {
      /* fall through */
    }
  }
  return copyOrSave(filename, text);
}

