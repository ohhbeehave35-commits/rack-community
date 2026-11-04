import { chromium } from '../panel/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const output = resolve(process.argv[2] || 'docs/screenshots');
const base = process.env.RACK_SCREENSHOT_URL || 'http://127.0.0.1:8080';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch(process.env.RACK_BROWSER_CHANNEL ? { channel: process.env.RACK_BROWSER_CHANNEL } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function shot(name) {
  await page.screenshot({ path: join(output, name), fullPage: true });
  console.log(name);
}
async function view(name) {
  await page.locator('aside').getByRole('button', { name, exact: true }).click();
}
try {
  await page.goto(base);
  if (process.env.RACK_OWNER_PASSWORD) {
    await page.getByLabel('Owner password').fill(process.env.RACK_OWNER_PASSWORD);
    await page.getByRole('button', { name: 'Unlock Rack', exact: true }).click();
  }
  await page.locator('[data-rack-ready="true"]').waitFor({ timeout: 60000 });
  await shot('01-overview.png');
  if (!process.env.RACK_TOKEN) throw new Error('RACK_TOKEN is required for control screenshots (never saved).');
  await page.getByLabel('Unlock controls', { exact: true }).fill(process.env.RACK_TOKEN);
  await page.getByRole('button', { name: 'Unlock controls', exact: true }).click();
  await page.getByText('Controls unlocked for this tab.').waitFor();
  await page.getByText('DRY-RUN', { exact: true }).waitFor({ timeout: 20000 });
  await shot('02-jobs.png');
  await view('Controls'); await page.getByRole('button', { name: 'Switch to LIVE' }).waitFor();
  await shot('03-controls.png');
  await view('Recipes'); await page.getByRole('tab', { name: 'Rack recipes' }).waitFor();
  await shot('04-recipes.png');
  await view('Run status'); await shot('05-run-status.png');
  await view('Jobs'); await page.getByRole('tab', { name: 'TalkBack', exact: true }).click();
  const room = page.frameLocator('iframe[title="TalkBack"]');
  await room.locator('[data-room-ready="true"]').waitFor({ timeout: 60000 });
  await room.getByRole('button', { name: /Recommended.*Floor/ }).click({ timeout: 60000 });
  await room.getByText('Wire desk', { exact: true }).first().waitFor({ timeout: 60000 });
  await shot('06-talkback.png');
  await room.getByRole('button', { name: /Wire desk/ }).first().click();
  await shot('07-wire-desk.png');
  await view('Recipes'); await page.getByRole('tab', { name: 'Somnus', exact: true }).click();
  const memory = page.frameLocator('iframe[title="Somnus"]');
  await memory.locator('[data-somnus-ready="true"]').waitFor({ timeout: 60000 });
  await memory.getByRole('button', { name: 'Skip, show me the full tour instead' }).click({ timeout: 60000 });
  await memory.getByRole('button', { name: 'Skip, show me the full tour instead' }).waitFor({ state: 'hidden' });
  await page.getByLabel('Somnus page').selectOption('/memory');
  await memory.getByRole('heading', { name: 'Memory', exact: true }).waitFor({ timeout: 60000 });
  await shot('08-somnus.png');
  await page.getByLabel('Somnus page').selectOption('/gate');
  await memory.getByRole('heading', { name: 'The gate', exact: true }).waitFor({ timeout: 60000 });
  await shot('09-memory-gate.png');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('SCREENSHOTS: PASS (9 files, 1440px wide)');
} catch (error) {
  console.error('Browser verification failed:', error.message);
  for (const frame of page.frames()) console.error((await frame.locator('body').innerText().catch(() => '')).slice(0, 5000));
  throw error;
} finally { await browser.close(); }
