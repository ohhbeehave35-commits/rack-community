// Rule 48: nothing on screen under 16px. Boots must be running; point this at a
// running Somnus (default http://127.0.0.1:8081) and it walks every tab,
// measures the computed font-size of every leaf text node, and fails (exit 1)
// on anything under 16px. This is the rendered half; scripts/no-emdash.test.mjs
// is the static half.
import { chromium } from "playwright";

const BASE = process.env.SOMNUS_URL || "http://127.0.0.1:8081";
const ROUTES = ["/", "/assistant", "/memory", "/gate", "/jobs", "/audit"];
const FLOOR = 16;

const SCAN = `() => {
  const bad = [];
  const walk = (root) => {
    root.querySelectorAll("*").forEach((el) => {
      if (el.children.length === 0 && el.textContent.trim()) {
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px && px < ${FLOOR} - 0.5) {
          bad.push({ px: Math.round(px * 10) / 10, tag: el.tagName, text: el.textContent.trim().slice(0, 40) });
        }
      }
    });
  };
  walk(document.body);
  const seen = new Set(), uniq = [];
  for (const b of bad) { const k = b.px + b.text; if (!seen.has(k)) { seen.add(k); uniq.push(b); } }
  return uniq;
}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let fails = 0;
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const bad = await page.evaluate(eval("(" + SCAN + ")"));
  if (bad.length) {
    fails += bad.length;
    console.log(`UNDER ${FLOOR}px on ${r}:`);
    for (const b of bad.slice(0, 12)) console.log(`  ${b.px}px ${b.tag} "${b.text}"`);
  } else {
    console.log(`ok   ${r}`);
  }
}
await browser.close();
if (fails) { console.log(`\nFONT FLOOR FAILED: ${fails} elements under ${FLOOR}px`); process.exit(1); }
console.log(`\nFONT FLOOR CLEAN: nothing under ${FLOOR}px`);
