// Browser smoke test: drives the real app the way a person would and saves
// screenshots to assets/. Needs the app running (npm run dev or npm run preview).
//
//   node scripts/smoke.ts [baseUrl]      default http://127.0.0.1:5181/

import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const out = join(root, 'assets');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

async function run(name: string, viewport: { width: number; height: number }, fn: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await fn(page);
  } catch (e) {
    check(false, `${name}: ${e instanceof Error ? e.message : e}`);
  }
  check(errors.length === 0, `${name}: no console errors${errors.length ? ` (${errors.join(' | ')})` : ''}`);
  await ctx.close();
}

const settle = (page: Page) => page.waitForTimeout(2600); // split + arc animation

await run('desktop', { width: 1280, height: 860 }, async (page) => {
  await page.goto(base);
  await page.getByRole('heading', { name: /Every part/ }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'start-desktop.png') });
  check(true, 'start screen renders');

  // Nutella: the records disagree -> the app asks one question instead of guessing
  await page.getByRole('button', { name: 'Nutella jar' }).click();
  await page.locator('.bin--needs').waitFor({ timeout: 20000 });
  await settle(page);
  await page.screenshot({ path: join(out, 'result-conflict-asks.png'), fullPage: true });
  const ask = page.locator('.bin--needs .piece-ask');
  check((await ask.count()) >= 1, `doubtful part shows a one-tap question: "${(await ask.first().locator('p').textContent())?.trim()}"`);
  await page.locator('.bin--needs [data-drop]').first().click();
  await page.waitForTimeout(1200);
  check((await page.locator('.bin--needs').count()) === 0, 'answering clears "Needs your answer"');
  const othersCount = await page.locator('.bin[data-bin="others"] .piece').count();
  check(othersCount === 2, `glass jar and aluminium seal land in Others (Lain-lain): ${othersCount} piece(s)`);
  const plasticCount = await page.locator('.bin[data-bin="plastic"] .piece').count();
  check(plasticCount === 1, `plastic lid lands in Plastics (Plastik): ${plasticCount} piece(s)`);
  await page.screenshot({ path: join(out, 'result-malaysia.png'), fullPage: true });

  // Detail sheet with the source
  await page.locator('.bin[data-bin="others"] .piece-main').first().click();
  await page.locator('#sheet .sheet').waitFor();
  await page.waitForTimeout(400);
  const srcLink = await page.locator('#sheet .source a').first().getAttribute('href');
  check(!!srcLink && srcLink.includes('swcorp.gov.my'), `part sheet links the SWCorp source (${srcLink})`);
  await page.screenshot({ path: join(out, 'part-sheet-source.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Switch area: parts re-sort into the Singapore blue bin
  await page.getByRole('button', { name: /Singapore/ }).click();
  await page.waitForTimeout(1400);
  const blue = await page.locator('.bin[data-bin="blue"] .piece').count();
  check(blue >= 1, `switching to Singapore re-sorts parts into the blue bin: ${blue}`);
  await page.screenshot({ path: join(out, 'result-singapore.png'), fullPage: true });

  // Unknown barcode -> two-tap path still gives an answer
  await page.getByRole('button', { name: /Malaysia/ }).click();
  const input = page.locator('[data-lookup] input');
  await input.fill('2000000000008');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Describe a part' }).waitFor({ timeout: 20000 });
  check(true, 'unknown barcode offers the two-tap path');
  await page.getByRole('button', { name: 'Describe a part' }).click();
  await page.locator('[data-ask-shape="bottle"]').click();
  await page.locator('[data-ask-material="plastic"]').click();
  await page.waitForTimeout(900);
  const plastic = await page.locator('.bin[data-bin="plastic"] .piece').count();
  check(plastic === 1, 'two taps (bottle, plastic) put a part in Plastics');
  await page.screenshot({ path: join(out, 'two-tap-path.png'), fullPage: true });

  // About: measured coverage
  await page.getByRole('button', { name: 'About' }).click();
  await page.locator('.big-figure').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'about-coverage.png') });
  check(true, `about shows coverage: ${await page.locator('.big-figure').textContent()}`);
});

await run('phone', { width: 390, height: 844 }, async (page) => {
  await page.goto(base);
  await page.getByRole('heading', { name: /Every part/ }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'start-phone.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal scroll at 390 px');
  await page.goto(`${base}?code=5449000000996&area=my-act672`);
  await page.locator('.bin .piece').first().waitFor({ timeout: 20000 });
  await settle(page);
  await page.screenshot({ path: join(out, 'result-phone.png'), fullPage: true });
  check(true, 'deep link ?code= opens a result on a phone');
});

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
