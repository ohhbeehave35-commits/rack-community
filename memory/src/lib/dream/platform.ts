export type ClientKind = "ios" | "android" | "windows" | "mac" | "linux" | "unknown";

export function detectClient(): ClientKind {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const iPadOs =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iPadOs) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

export function isHandheld(kind: ClientKind = detectClient()) {
  return kind === "ios" || kind === "android";
}

export function clientLabel(kind: ClientKind) {
  switch (kind) {
    case "ios":
      return "iPhone / iPad";
    case "android":
      return "Android";
    case "windows":
      return "Windows";
    case "mac":
      return "Mac";
    case "linux":
      return "Linux";
    default:
      return "this device";
  }
}
