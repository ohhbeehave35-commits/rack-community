/**
 * Display formatting for the ISO-8601 stamps the dream store keeps.
 *
 * The store deliberately keeps `lastDream`, snapshot `at` and audit `at` as
 * full `new Date().toISOString()` strings: they are identities (a snapshot is
 * looked up by its `at`) and they end up inside downloadable artifacts, where
 * an unambiguous UTC stamp is the right thing. They are not, however, something
 * to put in front of a reader, `2026-09-03T14:22:07.918Z` in a `text-2xl` stat
 * tile wraps and clips at phone width. Format at the edge instead: parse here,
 * render short, leave the stored value alone.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseStamp(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `14:22`, wall-clock time of the stamp, in the reader's own zone. */
export function stampTime(iso: string | null | undefined, fallback = "n/a") {
  const d = parseStamp(iso);
  return d ? `${two(d.getHours())}:${two(d.getMinutes())}` : fallback;
}

/** `Sep 3`, calendar day of the stamp, no year. */
export function stampDate(iso: string | null | undefined, fallback = "n/a") {
  const d = parseStamp(iso);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : fallback;
}

/** `Sep 3, 14:22`, compact one-liner for inline prose and badges. */
export function stampShort(iso: string | null | undefined, fallback = "never") {
  const d = parseStamp(iso);
  return d ? `${stampDate(iso)}, ${stampTime(iso)}` : fallback;
}
