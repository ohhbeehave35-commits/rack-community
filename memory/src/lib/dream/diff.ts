export type DiffLine = { kind: "same" | "add" | "del"; text: string };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
      continue;
    }
    const laterInB = j < b.length && a[i] != null && b.slice(j + 1, j + 8).includes(a[i]!);
    const laterInA = i < a.length && b[j] != null && a.slice(i + 1, i + 8).includes(b[j]!);
    if (laterInB && !laterInA) {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    } else if (i < a.length && (laterInA || j >= b.length)) {
      out.push({ kind: "del", text: a[i]! });
      i += 1;
    } else if (j < b.length) {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    } else if (i < a.length) {
      out.push({ kind: "del", text: a[i]! });
      i += 1;
    }
  }
  return out;
}
