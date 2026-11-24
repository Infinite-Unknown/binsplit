// Records the demo footage from the real running app, then hands it to the
// renderer (scripts/video/render.ts), which adds the camera moves, cursor,
// captions, title cards and voice-over and writes assets/demo.mp4.
//
// What this script does:
//   1. Makes the voice-over lines with a local text-to-speech script (voice af_heart) and measures them.
//   2. Drives the app in Chromium at 1600x900, device scale 2, and captures 3200x1800
//      frames with their timestamps. A 2x screenshot takes ~50 ms, so the page runs in
//      slow motion while it is filmed: the document timeline (every CSS and Web Animation)
//      plays at 1/K speed and page timers wait K times longer. Every time logged here is
//      in that slowed-down clock, so the finished video plays at the app's real speed.
//   3. Logs, against the same clock: where the cursor moves and clicks, where the
//      camera should look (rectangles read from the page with getBoundingClientRect),
//      when each voice line starts and which caption is showing.
//
//   npm run dev -- --port 5181 --host 127.0.0.1     (in another terminal)
//   TTS_PYTHON=/path/to/python TTS_SCRIPT=/path/to/tts.py node scripts/record-demo.ts [baseUrl]
//   (tts.py is called as: tts.py "text" out.wav --voice af_heart)
//   node scripts/video/render.ts
//
// Product lookups: Open Food Facts rate-limits heavy use. Like a user's phone, the app
// keeps every product it has looked up on the device (localStorage). The recording starts
// from those saved lookups (.cache/demo-storage.json, made by an earlier warm-up run),
// so the product header shows "Saved on this device". Product pictures are kept in
// .cache/video/img after the first fetch.

import { chromium, type Locator, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const work = join(root, '.cache/video');
const framesDir = join(work, 'frames');
const voDir = join(work, 'vo');
const imgDir = join(work, 'img');
const W = 1600;
const H = 900;
const DSF = 2;
const K = 4; // slow-motion factor while filming
rmSync(framesDir, { recursive: true, force: true });
for (const d of [framesDir, voDir, imgDir]) mkdirSync(d, { recursive: true });

// ---------- Voice-over ----------

const VO: Record<string, string> = {
  h1: 'This is BinSplit. Look up a product, and its packaging comes apart. Every part drops into the right bin, under official local rules.',
  p1:
    "The waste problem is contamination, and it's measured by what's in the bin. Clean and Green Singapore reports that forty percent of the items in recycling bins can't be recycled because of it. " +
    'Packaging mixes materials, and the rules change from place to place.',
  c1: 'Product records often disagree. One record for this jar lists six plastic bottles that the packaging text never mentions. So BinSplit doesn\'t guess. It asks.',
  c2: 'One tap settles it. The glass jar and the aluminium seal go to Others, and the plastic lid goes to Plastics.',
  s1: "Tap any part to see the rule behind it, quoted from S W Corp's leaflet, with a link to the official document.",
  n1: "Now, instant noodles. The foil-lined wrapper isn't in S W Corp's list, so BinSplit won't invent a bin for it.",
  n2: 'It marks the part as not covered here, says why, and links the official source it checked.',
  w1: "Switch the area to Singapore, and the same parts re-sort live, under N E A's rules. There, the wrapper goes to general waste.",
  t1: 'Plenty of products have no packaging data yet. Two taps, the shape and then the material, and the same official rules sort it.',
  k1:
    'Under the hood, Open Food Facts packaging fields are normalised with its multilingual taxonomy, reconciled into parts with a confidence level, ' +
    'then matched to rule packs where every rule cites its official source.',
  a1: 'We measured coverage on two hundred and forty of the most-scanned products sold in Malaysia and Singapore.',
  a2: 'Ninety-five have packaging data in Open Food Facts. Of those, seventy-two get a bin for at least one part under the Malaysian rules, and forty-nine get every part sorted.',
  m1:
    'Coverage is the first way we measure impact. Next, a ten-item sorting quiz before and after using the app. ' +
    "Then a pilot that weighs the contamination in one residence block's recycling bins, before and after four weeks.",
  o1: "There's no account, no server, and no key. Products you've looked up are saved on this device, so they keep working offline.",
  e1: 'BinSplit. Open data, official rules, and every part in the right bin.',
};

function sh(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}
const duration = (file: string) =>
  Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

const voices: Record<string, { file: string; dur: number; text: string }> = {};
for (const [id, text] of Object.entries(VO)) {
  const file = join(voDir, `${createHash('sha1').update('af_heart|' + text).digest('hex').slice(0, 12)}.wav`);
  if (!existsSync(file)) {
    const py = process.env.TTS_PYTHON;
    const tts = process.env.TTS_SCRIPT;
    if (!py || !tts) throw new Error('Set TTS_PYTHON and TTS_SCRIPT to make the voice-over (voice af_heart).');
    sh(py, ['-I', tts, text, file, '--voice', 'af_heart']);
  }
  voices[id] = { file, dur: duration(file), text };
  console.log(`vo ${id}: ${voices[id].dur.toFixed(1)}s`);
}

// ---------- Recording log ----------

type Rect = { x: number; y: number; w: number; h: number };
const events: Array<Record<string, unknown> & { t: number; kind: string }> = [];
// The filmed clock: real time slowed down K times, so it matches the app's own time.
const R0 = Date.now() / 1000;
const vclock = (realMs: number) => R0 + (realMs / 1000 - R0) / K;
const now = () => vclock(Date.now());
const ev = (kind: string, data: Record<string, unknown> = {}) => events.push({ t: now(), kind, ...data });
const realSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wait `ms` of filmed time. */
const sleep = (ms: number) => realSleep(ms * K);
const until = async (t: number) => {
  const ms = (t - now()) * 1000;
  if (ms > 0) await sleep(ms);
};

/** Start a voice line now; returns the time it ends. */
function say(id: string): number {
  ev('vo', { id });
  return now() + voices[id].dur;
}
const caption = (text: string | null) => ev('caption', { text });
const mark = (clip: string, edge: 'in' | 'out') => ev('mark', { clip, edge });

async function rectOf(loc: Locator): Promise<Rect> {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error(`no box for ${loc}`);
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
function union(...rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

/**
 * Point the camera at a rectangle of the page (CSS px). The zoom fits the rectangle
 * with some room around it, never more than maxZ. `at` shifts the start of the move
 * (seconds, may be negative: the edit can start a move just before the action).
 */
function cam(target: Rect | 'wide', o: { dur?: number; at?: number; pad?: number; maxZ?: number; z?: number; ease?: string } = {}) {
  const dur = o.dur ?? 1.0;
  if (target === 'wide') return ev('cam', { at: o.at ?? 0, dur, cx: W / 2, cy: H / 2, z: 1, ease: o.ease ?? 'cubic' });
  const pad = o.pad ?? 1.25;
  const z = o.z ?? Math.max(1, Math.min(o.maxZ ?? 2.0, W / (target.w * pad), H / (target.h * pad)));
  ev('cam', { at: o.at ?? 0, dur, cx: target.x + target.w / 2, cy: target.y + target.h / 2, z, ease: o.ease ?? 'cubic' });
}

// ---------- Cursor: eased paths with a slight arc; the real mouse follows the same path ----------

let cursor = { x: 1240, y: 760 };
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function moveTo(page: Page, x: number, y: number, ms?: number) {
  const from = { ...cursor };
  const dist = Math.hypot(x - from.x, y - from.y);
  const total = ms ?? Math.min(1100, Math.max(450, 320 + dist * 0.55));
  const steps = Math.max(6, Math.round(total / 16));
  // A gentle arc: offset the midpoint sideways by a few percent of the distance.
  const nx = -(y - from.y) / (dist || 1);
  const ny = (x - from.x) / (dist || 1);
  const bow = Math.min(60, dist * 0.08);
  const t0 = now();
  for (let i = 1; i <= steps; i++) {
    const p = easeInOut(i / steps);
    const lift = Math.sin(Math.PI * p) * bow;
    const px = from.x + (x - from.x) * p + nx * lift;
    const py = from.y + (y - from.y) * p + ny * lift;
    await page.mouse.move(px, py);
    ev('cursor', { x: px, y: py });
    await until(t0 + (total * i) / steps / 1000);
  }
  cursor = { x, y };
}

async function pointAt(page: Page, loc: Locator, ms?: number, fx = 0.5, fy = 0.5) {
  const r = await rectOf(loc);
  await moveTo(page, r.x + r.w * fx, r.y + r.h * fy, ms);
  return r;
}

async function click(page: Page, loc: Locator, opts: { ms?: number; fx?: number; fy?: number } = {}) {
  await pointAt(page, loc, opts.ms, opts.fx, opts.fy);
  await sleep(140);
  ev('click', { x: cursor.x, y: cursor.y });
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

async function typeInto(page: Page, input: Locator, text: string) {
  await click(page, input, { fx: 0.3 });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(38 + Math.random() * 30);
  }
}

// ---------- Browser ----------

const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const savedCache = join(root, '.cache/demo-storage.json');
if (!existsSync(savedCache)) throw new Error('Missing .cache/demo-storage.json (saved product lookups). Run the app once on each demo product first.');
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DSF,
  storageState: savedCache,
  reducedMotion: 'no-preference',
});

// Product pictures: fetched once, then served from .cache/video/img.
await ctx.route('https://images.openfoodfacts.org/**', async (route) => {
  const url = route.request().url();
  const file = join(imgDir, createHash('sha1').update(url).digest('hex').slice(0, 16));
  if (existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: 'image/jpeg' });
  try {
    const res = await route.fetch();
    const body = await res.body();
    if (res.ok()) writeFileSync(file, body);
    return route.fulfill({ response: res, body });
  } catch {
    return route.abort();
  }
});
let apiCalls = 0;
ctx.on('request', (r) => {
  if (/openfoodfacts\.org\/api/.test(r.url())) {
    apiCalls++;
    console.warn('live Open Food Facts lookup (not saved on this device):', r.url());
  }
});

// Slow motion, part 1: page timers wait K times longer, and smooth scrolling is driven
// by the page so it slows down too. Part 2 (the animation timeline) is set below.
await ctx.addInitScript((k: number) => {
  const st = window.setTimeout.bind(window);
  const si = window.setInterval.bind(window);
  (window as any).setTimeout = (fn: TimerHandler, ms = 0, ...a: unknown[]) => st(fn, (Number(ms) || 0) * k, ...a);
  (window as any).setInterval = (fn: TimerHandler, ms = 0, ...a: unknown[]) => si(fn, (Number(ms) || 0) * k, ...a);
  const siv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
    if (!arg || typeof arg !== 'object' || arg.behavior !== 'smooth') return siv.call(this, arg);
    const r = this.getBoundingClientRect();
    const dy = arg.block === 'center' ? r.top + r.height / 2 - innerHeight / 2 : arg.block === 'end' ? r.bottom - innerHeight : r.top;
    const from = scrollY;
    const to = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, from + dy));
    const dur = Math.min(800, Math.max(350, Math.abs(to - from) * 0.8)) * k;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      window.scrollTo(0, from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
}, K);

const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

// Off camera: load every product picture once so it is in the image cache.
await page.goto(base + '?area=my-act672');
await page.evaluate(async () => {
  const urls = Object.keys(localStorage)
    .filter((k) => k.startsWith('binsplit:product:'))
    .map((k) => JSON.parse(localStorage.getItem(k)!)?.image_front_small_url)
    .filter(Boolean) as string[];
  await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; })));
});
await page.goto(base + '?area=my-act672');
await page.getByRole('heading', { name: /Every part/ }).waitFor();
await page.evaluate(() => document.fonts.ready);
await realSleep(900);
await page.mouse.move(cursor.x, cursor.y);

// ---------- Capture: 3200x1800 frames in a loop, identical frames stored once ----------

const cdp = await ctx.newCDPSession(page);
// Slow motion, part 2: every CSS transition, CSS animation and Web Animation plays at 1/K.
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K });
const frames: Array<{ t: number; f: number }> = [];
let stored = 0;
let capturing = true;
const capture = (async () => {
  let last = '';
  while (capturing) {
    const a = Date.now();
    // A clip with scale 2 renders the viewport at device scale 2 (3200x1800), not an upscale.
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 94,
      optimizeForSpeed: true,
      clip: { x: 0, y: 0, width: W, height: H, scale: DSF },
    });
    const t = vclock((a + Date.now()) / 2);
    if (r.data !== last) {
      writeFileSync(join(framesDir, `${stored}.jpg`), Buffer.from(r.data, 'base64'));
      stored++;
      last = r.data;
    }
    frames.push({ t, f: stored - 1 });
  }
})();
await sleep(500);

const L = {
  chip: (code: string) => page.locator(`[data-sample="${code}"]`),
  product: page.locator('#product'),
  stage: page.locator('#stage'),
  bins: page.locator('#bins'),
  search: page.locator('[data-lookup] input'),
  sheet: page.locator('#sheet .sheet'),
};

// ===== Clip: hook. The signature moment first: parts cut from the product, held, then into their bins. =====
mark('hook', 'in');
cam('wide', { dur: 0 });
ev('cursor', { x: cursor.x, y: cursor.y });
caption('BinSplit · Every part. The right bin.');
let end = say('h1');
await sleep(700);
await click(page, L.chip('3017620422003'), { ms: 800 });
await L.product.waitFor();
await sleep(60);
{
  const prod = await rectOf(L.product);
  cam(prod, { pad: 1.06, dur: 0.9, at: -0.15 });
}
// Cut + hold take about a second; then the parts arc down into the bins.
await sleep(1050);
await page.locator('.bin--needs').waitFor();
cam(union(await rectOf(L.product), await rectOf(L.bins)), { pad: 1.04, dur: 1.1 });
caption('Cut from the product, then sorted part by part');
await until(end + 0.7);
mark('hook', 'out');

// ===== Clip: conflict question, then a part's source. =====
await sleep(200);
mark('conflict', 'in');
caption('The records disagree on one part, so it asks');
end = say('c1');
await sleep(500);
const needs = page.locator('.bin--needs');
cam(await rectOf(needs), { pad: 1.12, dur: 1.1 });
await pointAt(page, needs.locator('.piece-main'), 900, 0.6, 0.5);
await until(end - 0.3);
await click(page, needs.locator('[data-drop]'), { ms: 700 });
end = say('c2');
await sleep(500);
caption('Glass jar and seal: Others (Lain-lain). Lid: Plastics (Plastik).');
cam(union(await rectOf(page.locator('.bin[data-bin="plastic"]')), await rectOf(page.locator('.bin[data-bin="others"]'))), { pad: 1.2, dur: 1.1, at: -0.2 });
await until(end + 0.4);

end = say('s1');
caption('Every answer quotes its official source');
await click(page, page.locator('.bin[data-bin="others"] .piece-main').first(), { ms: 750 });
await L.sheet.waitFor();
await sleep(280);
cam(await rectOf(L.sheet), { pad: 1.08, dur: 1.0, at: -0.1 });
await sleep(1500);
{
  const rule = page.locator('#sheet .quote');
  const src = page.locator('#sheet .source').first();
  const r = union(await rectOf(rule), await rectOf(src));
  cam(r, { pad: 1.3, maxZ: 2.0, dur: 1.1 });
  await pointAt(page, page.locator('#sheet .source a').first(), 900, 0.35, 0.6);
}
await until(end + 0.6);
cam('wide', { dur: 0.9 });
await click(page, page.locator('#sheet .sheet-close'), { ms: 650 });
await sleep(700);
mark('conflict', 'out');

// ===== Clip: Not covered here, then the area switch. =====
mark('noodles', 'in');
cam(await rectOf(page.locator('.searchbar')), { pad: 1.5, dur: 0.9 });
end = say('n1');
await typeInto(page, L.search, '8801073113312');
await sleep(250);
await page.keyboard.press('Enter');
await L.product.waitFor();
await sleep(60);
cam(union(await rectOf(L.product), await rectOf(L.bins)), { pad: 1.04, dur: 1.0, at: 0 });
await sleep(2100);
const gap = page.locator('.bin--gap');
cam(await rectOf(gap), { pad: 1.25, dur: 1.0 });
caption('Not covered here: no official rule, so no bin is guessed');
await pointAt(page, gap.locator('.piece-main'), 800, 0.55, 0.45);
await until(end + 0.2);
end = say('n2');
await click(page, gap.locator('.piece-main'), { ms: 300, fx: 0.55, fy: 0.45 });
await L.sheet.waitFor();
await sleep(280);
cam(await rectOf(L.sheet), { pad: 1.08, dur: 0.9, at: -0.1 });
await sleep(1200);
{
  const why = page.locator('#sheet section').first();
  cam(await rectOf(why), { pad: 1.15, maxZ: 2.0, dur: 1.1 });
  await sleep(500);
  await pointAt(page, page.locator('#sheet section').first().locator('a').first(), 900, 0.4, 0.6);
  caption('It links the official source it checked');
}
await until(end + 1.0);
cam('wide', { dur: 0.9 });
await click(page, page.locator('#sheet .sheet-close'), { ms: 650 });
await sleep(600);

const sg = page.locator('[data-pack="sg-nea"]');
cam(union(await rectOf(page.locator('.area')), await rectOf(L.product)), { pad: 1.1, dur: 1.0 });
end = say('w1');
await click(page, sg, { ms: 900 });
caption('Same parts, re-sorted under Singapore (NEA) rules');
await sleep(80);
cam(union(await rectOf(L.product), await rectOf(L.bins)), { pad: 1.04, dur: 1.0, at: 0.1 });
await sleep(1900);
cam(await rectOf(page.locator('.bin[data-bin="general"]')), { pad: 1.3, dur: 1.0 });
await until(end + 0.6);
mark('noodles', 'out');

// ===== Clip: no packaging data, two taps. =====
cam('wide', { dur: 0 });
await sleep(150);
mark('twotap', 'in');
cam(await rectOf(page.locator('.searchbar')), { pad: 1.5, dur: 0.8, at: 0 });
end = say('t1');
caption('No packaging data? Describe a part in two taps');
await typeInto(page, L.search, '9556231110045');
await sleep(200);
await page.keyboard.press('Enter');
const describe = page.getByRole('button', { name: 'Describe a part' });
await describe.waitFor();
await sleep(150);
cam(union(await rectOf(L.product), await rectOf(page.locator('#stage-body .panel'))), { pad: 1.1, dur: 1.0 });
await sleep(700);
await click(page, describe, { ms: 700 });
await sleep(900); // the shape tiles scroll into view
cam(await rectOf(page.locator('#ask')), { pad: 1.08, dur: 0.9 });
await sleep(500);
await click(page, page.locator('[data-ask-shape="bag"]'), { ms: 750 });
await sleep(550);
cam(await rectOf(page.locator('#ask')), { pad: 1.08, dur: 0.7 });
await click(page, page.locator('[data-ask-material="plastic"]'), { ms: 750 });
await sleep(1300); // the new part lands and scrolls into view
{
  const part = page.locator('[data-part^="u"]').first();
  const bin = part.locator('xpath=ancestor::div[contains(@class,"bin ")]');
  cam(union(await rectOf(bin), await rectOf(part)), { pad: 1.35, dur: 1.0 });
}
await until(end + 0.8);
mark('twotap', 'out');

// ===== Clip: measured coverage (About). =====
cam('wide', { dur: 0 });
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(300);
mark('about', 'in');
end = say('a1');
await click(page, page.getByRole('button', { name: 'About' }), { ms: 900 });
await page.locator('.big-figure').waitFor();
await sleep(300);
caption('Coverage, measured on 240 real barcodes');
cam(union(await rectOf(page.locator('#sheet-title')), await rectOf(page.locator('.figure-label'))), { pad: 1.12, maxZ: 2.0, dur: 1.1 });
await until(end + 0.2);
end = say('a2');
await pointAt(page, page.locator('.big-figure'), 900, 0.7, 0.6);
await until(end - 2.2);
caption(null); // the table needs the space the caption bar would cover
cam(union(await rectOf(page.locator('.big-figure')), await rectOf(page.locator('.cov-table'))), { pad: 1.12, maxZ: 2.0, dur: 1.2 });
await until(end + 0.7);
mark('about', 'out');

// ===== Clip: saved on this device, offline. =====
cam('wide', { dur: 0 });
await page.keyboard.press('Escape');
await sleep(400);
await page.locator('[data-home]').click();
await page.getByRole('heading', { name: /Every part/ }).waitFor();
await sleep(900);
mark('offline', 'in');
end = say('o1');
await ctx.setOffline(true);
caption('Network off');
const startInput = page.locator('[data-lookup] input');
cam(union(await rectOf(startInput), await rectOf(page.locator('.start h1'))), { pad: 1.2, dur: 1.0 });
await typeInto(page, startInput, '3017620422003');
await sleep(250);
await page.keyboard.press('Enter');
await L.product.waitFor();
await sleep(60);
cam(await rectOf(L.product), { pad: 1.06, dur: 1.0 });
caption('Saved on this device: it works offline');
await sleep(2300);
cam(union(await rectOf(page.locator('.product-img')), await rectOf(page.locator('.product-sub'))), { pad: 1.2, maxZ: 2.0, dur: 1.0 });
await until(end + 0.9);
mark('offline', 'out');
await ctx.setOffline(false);

await sleep(300);
capturing = false;
await capture;
await browser.close();

// ---------- Hand-off to the renderer ----------

// The edit: clips in order, with the title-style cards between them.
const edit = [
  { kind: 'clip', id: 'hook' },
  { kind: 'card', card: 'problem', vo: 'p1' },
  { kind: 'clip', id: 'conflict' },
  { kind: 'clip', id: 'noodles' },
  { kind: 'clip', id: 'twotap' },
  { kind: 'card', card: 'how', vo: 'k1' },
  { kind: 'clip', id: 'about' },
  { kind: 'card', card: 'measure', vo: 'm1' },
  { kind: 'clip', id: 'offline' },
  { kind: 'card', card: 'end', vo: 'e1' },
];

writeFileSync(
  join(work, 'rec.json'),
  JSON.stringify({ viewport: { w: W, h: H, dsf: DSF }, slowMotion: K, base, voices, frames, events, edit }, null, 0),
);
const span = frames[frames.length - 1].t - frames[0].t;
console.log(`frames: ${frames.length} (${(frames.length / span).toFixed(0)} per filmed second, ${stored} distinct), events: ${events.length}, live lookups: ${apiCalls}, page errors: ${errors.length ? errors.join(' | ') : 0}`);
