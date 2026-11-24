// Records the demo video from the real running app: drives it with Playwright,
// adds a themed caption bar, a macOS `say` voice-over, and joins the scenes
// with ffmpeg into assets/demo.mp4.
//
//   npm run dev -- --port 5181     (in another terminal)
//   node scripts/record-demo.ts [baseUrl]

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const work = join(root, '.cache/demo');
const W = 1280;
const H = 720;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

interface Scene {
  id: string;
  vo: string;
  caption?: string;
  card?: string;
  run?: (page: Page) => Promise<void>;
}

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

async function caption(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;max-width:880px;' +
        'background:#17201c;color:#f3efe6;font:600 20px/1.35 "Instrument Sans Variable",sans-serif;' +
        'padding:12px 20px;border-radius:14px;box-shadow:0 18px 40px -18px rgb(23 32 28/.6);text-align:center;' +
        'transition:opacity 200ms ease';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

/** Look a barcode up through the search field, retrying if Open Food Facts is busy. */
async function lookup(page: Page, code: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const input = page.locator('[data-lookup] input');
    await input.fill(code);
    await input.press('Enter');
    const done = await page
      .locator('#stage-body .bin, #stage-body .panel')
      .first()
      .waitFor({ timeout: 25000 })
      .then(() => true, () => false);
    const busy = await page.locator('.panel h3', { hasText: /busy|did not answer/ }).count();
    if (done && !busy) return;
    await wait(page, 20000);
  }
  throw new Error(`lookup ${code} kept failing`);
}

const scenes: Scene[] = [
  {
    id: '00-title',
    card: 'title',
    vo: 'BinSplit. Scan a barcode, and every part of the packaging goes to the right bin.',
  },
  {
    id: '01-cold-open',
    caption: 'A real jar of Nutella, looked up live in Open Food Facts',
    vo:
      'This is a jar of Nutella. BinSplit looks up its packaging, splits it into parts, and sorts each part under the Malaysian rules from S W Corp. ' +
      'Here the records disagree: one lists six plastic bottles, the packaging text does not. So BinSplit asks, instead of guessing.',
    run: async (page) => {
      await page.goto(base + '?area=my-act672');
      await page.getByRole('heading', { name: /Every part/ }).waitFor();
      await wait(page, 1800);
      await page.getByRole('button', { name: 'Nutella jar' }).click();
      await page.locator('.bin--needs').waitFor({ timeout: 30000 });
      await wait(page, 7000);
      await caption(page, 'The records disagree, so it asks one question');
      await wait(page, 3500);
      await page.locator('[data-drop]').first().click();
      await caption(page, 'Glass jar and aluminium seal: Others. Plastic lid: Plastics.');
      await wait(page, 4000);
    },
  },
  {
    id: '02-problem',
    card: 'problem',
    vo:
      "Singapore's environment agency says forty percent of the items in recycling bins cannot be recycled, because of contamination. " +
      'Packaging is mixed, and the rules change from place to place.',
  },
  {
    id: '03-products',
    caption: 'Three more real products',
    vo:
      'A bottle of green tea: the bottle and the cap both go to Plastics. Butter: the box goes to Papers, the film wrapper to Plastics. ' +
      'Instant noodles: the foil-lined wrapper is not in S W Corp\'s list, and BinSplit says so rather than guess.',
    run: async (page) => {
      await page.goto(base + '?area=my-act672&code=8888196173324');
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 30000 });
      await caption(page, 'Green tea: bottle and cap go to Plastics (Plastik)');
      await wait(page, 5500);
      await lookup(page, '8901262010016');
      await caption(page, 'Butter: box to Papers (Kertas), film to Plastics');
      await wait(page, 5500);
      await lookup(page, '8801073113312');
      await caption(page, 'Noodles: the foil-lined wrapper is not covered by the SWCorp list');
      await wait(page, 6000);
    },
  },
  {
    id: '04-region',
    caption: 'Switch the area: the same parts re-sort under NEA Singapore rules',
    vo:
      "Switch to Singapore, and the same parts re-sort under NEA's rules: the foil-lined wrapper is general waste there. " +
      'Tap any part to see the rule, and the official source it comes from.',
    run: async (page) => {
      await page.goto(base + '?area=my-act672&code=8801073113312');
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 30000 });
      await wait(page, 2600);
      await page.getByRole('button', { name: /Singapore/ }).click();
      await wait(page, 3200);
      await page.locator('.bin[data-bin="general"] .piece-main').first().click();
      await caption(page, 'Every answer cites its official source');
      await wait(page, 6000);
    },
  },
  {
    id: '05-photo-and-two-tap',
    caption: 'Barcode photo, decoded in the browser',
    vo:
      'Scan with the camera, or a photo. Decoding runs in the browser. ' +
      'If a product has no packaging data, two taps describe the part, and the same official rules sort it.',
    run: async (page) => {
      await page.goto(base + '?area=my-act672');
      await page.getByRole('heading', { name: /Every part/ }).waitFor();
      await wait(page, 800);
      await page.locator('#photo').setInputFiles(join(root, 'assets/test-barcode-5449000000996.png'));
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 30000 });
      await wait(page, 4000);
      await caption(page, 'No data for this barcode? Describe the part in two taps');
      await lookup(page, '9556231110045');
      await wait(page, 1200);
      await page.getByRole('button', { name: 'Describe a part' }).click();
      await wait(page, 1000);
      await page.locator('[data-ask-shape="bag"]').click();
      await wait(page, 1000);
      await page.locator('[data-ask-material="plastic"]').click();
      await wait(page, 2500);
    },
  },
  {
    id: '06-how',
    card: 'how',
    vo:
      'Under the hood: Open Food Facts data, normalised with its packaging taxonomy, reconciled across fields with a confidence level, ' +
      'then matched to rule packs where every rule cites its source. We measured coverage on two hundred and forty of the most scanned products sold in Malaysia and Singapore. ' +
      'Many products have no packaging data yet, which is why the two-tap path exists.',
  },
  {
    id: '07-offline',
    caption: 'Offline: products you have looked up still work',
    vo: 'No account, no server, no key. It is a static site, and products you have already looked up keep working offline.',
    run: async (page) => {
      await page.goto(base + '?area=my-act672&code=3017620422003');
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 30000 });
      await wait(page, 1500);
      await page.context().setOffline(true);
      await page.locator('[data-home]').click();
      await page.getByRole('heading', { name: /Every part/ }).waitFor();
      await caption(page, 'Network off. Same jar again.');
      await wait(page, 1200);
      const input = page.locator('[data-lookup] input');
      await input.fill('3017620422003');
      await input.press('Enter');
      await page.locator('#stage-body .bin .piece').first().waitFor({ timeout: 10000 });
      await wait(page, 4500);
      await page.context().setOffline(false);
    },
  },
  {
    id: '08-measure',
    card: 'measure',
    vo:
      'How we would measure impact: coverage, which we measured; a sorting quiz before and after; and a bin audit of one residence block over four weeks.',
  },
  { id: '09-end', card: 'end', vo: 'BinSplit. Open data, official rules, every part in the right bin.' },
];

function sh(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}
const duration = (file: string) =>
  Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

const browser: Browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
let storage: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
const segments: string[] = [];

for (const scene of scenes) {
  const voFile = join(work, `${scene.id}.aiff`);
  sh('say', ['-v', 'Samantha', '-r', '178', '-o', voFile, scene.vo]);
  const voLen = duration(voFile);

  const dir = join(work, scene.id);
  mkdirSync(dir);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } }, storageState: storage });
  const t0 = Date.now();
  const page = await ctx.newPage();
  let start = 0;
  if (scene.card) {
    await page.goto(`${base}scripts/video/card.html?card=${scene.card}`);
    await page.locator('#card > *').first().waitFor();
    start = (Date.now() - t0) / 1000;
    await wait(page, Math.ceil(voLen * 1000) + 900);
  } else {
    start = (Date.now() - t0) / 1000;
    const sceneStart = Date.now();
    await scene.run!(page);
    if (scene.caption && !(await page.locator('#demo-caption').count())) await caption(page, scene.caption);
    const spent = (Date.now() - sceneStart) / 1000;
    if (spent < voLen + 0.8) await wait(page, Math.ceil((voLen + 0.8 - spent) * 1000));
  }
  storage = await ctx.storageState();
  await ctx.close();
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))!;
  renameSync(join(dir, webm), join(dir, 'clip.webm'));

  // Trim the blank start, keep the voice from the scene start, pad audio to the clip length.
  const seg = join(work, `${scene.id}.mp4`);
  const clipLen = duration(join(dir, 'clip.webm')) - start;
  sh('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-ss', String(start), '-i', join(dir, 'clip.webm'),
    '-i', voFile,
    '-filter_complex', `[1:a]adelay=300|300,apad[a]`,
    '-map', '0:v', '-map', '[a]', '-t', String(clipLen),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    seg,
  ]);
  segments.push(seg);
  console.log(`${scene.id}: ${clipLen.toFixed(1)}s (voice ${voLen.toFixed(1)}s)`);
}
await browser.close();

const list = join(work, 'list.txt');
writeFileSync(list, segments.map((s) => `file '${s}'`).join('\n'));
const out = join(root, 'assets/demo.mp4');
sh('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
console.log(`demo: ${duration(out).toFixed(1)}s -> ${out}`);
