// Renders assets/demo.mp4 from the footage and log made by scripts/record-demo.ts.
//
//   node scripts/video/render.ts [baseUrl]        (the dev server must be running)
//
// 1. Builds the edit: clips cut from the recording at their in/out marks (with any held
//    frames the recorder asked for), cards in between, a short crossfade at every join,
//    each voice phrase placed where it started, and a callout for whatever it names.
// 2. Renders every 1920x1080 frame at 60 fps in scripts/video/render.html (several
//    pages in parallel), each piped into its own x264 encoder.
// 3. Mixes the voice-over, normalises it to -16 LUFS (two-pass loudnorm), and muxes.
// 4. Writes an upload copy under 9.5 MB (two-pass, gitignored) for browser upload limits.

import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.argv[2] ?? 'http://127.0.0.1:5181/';
const work = join(root, '.cache/video');
const out = join(root, 'assets/demo.mp4');
const uploadOut = join(root, 'assets/demo-upload.mp4');
const FPS = 60;
const OVERLAP = 0.4;
const WORKERS = Number(process.env.WORKERS ?? 4);

type Ev = { t: number; kind: string; off?: number; [k: string]: any };
type Beat = { vo: string; sel: string; text?: string; label?: string; underline?: boolean; pulse?: boolean; gap?: number };
const rec = JSON.parse(readFileSync(join(work, 'rec.json'), 'utf8')) as {
  viewport: { w: number; h: number; dsf: number };
  gap: number;
  voices: Record<string, { file: string; dur: number; text: string }>;
  frames: Array<{ t: number; f: number }>;
  events: Ev[];
  edit: Array<{ kind: 'clip'; id: string } | { kind: 'card'; card: string; beats: Beat[] }>;
};

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const ffprobe = (file: string, entries: string) =>
  sh('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1:nk=1', file]).trim();

// ---------- The edit ----------

// Edit time: recording time, plus any held frames inserted before it. Events logged
// "inside" a hold carry `off`, their offset into it.
const inserts = rec.events.filter((e) => e.kind === 'insert').map((e) => ({ t: e.t, d: e.d as number })).sort((a, b) => a.t - b.t);
const et = (e: Ev) => e.t + inserts.filter((i) => i.t < e.t).reduce((a, i) => a + i.d, 0) + (e.off ?? 0);
const events = rec.events.filter((e) => e.kind !== 'insert').map((e) => ({ ...e, e: et(e) })).sort((a, b) => a.e - b.e);

const marks = new Map<string, number>();
for (const e of events) if (e.kind === 'mark') marks.set(`${e.clip}:${e.edge}`, e.e);

type Focus = { t0: number; t1: number; [k: string]: unknown };
type Item =
  | { kind: 'clip'; id: string; eIn: number; eOut: number; outStart: number; outDur: number; captions: Array<{ t0: number; t1: number; text: string }>; focus: Focus[] }
  | { kind: 'card'; card: string; outStart: number; outDur: number; focus: Focus[] };
const items: Item[] = [];
const voPlacements: Array<{ id: string; at: number }> = [];
let cursorT = 0;
for (const e of rec.edit) {
  const outStart = items.length ? cursorT - OVERLAP : 0;
  if (e.kind === 'card') {
    // Card phrases one after another; each names one part of the card while it is spoken.
    const lead = 0.6;
    let at = lead;
    const focus: Focus[] = [];
    for (const b of e.beats) {
      voPlacements.push({ id: b.vo, at: outStart + at });
      const len = rec.voices[b.vo].dur + (b.gap ?? rec.gap);
      focus.push({ t0: at - 0.05, t1: at + len - 0.05, sel: b.sel, text: b.text, label: b.label, underline: b.underline, pulse: b.pulse });
      at += len;
    }
    const tail = e.card === 'end' ? 1.8 : 0.7;
    focus[focus.length - 1].t1 = at + tail - 0.45;
    const outDur = at + tail;
    items.push({ kind: 'card', card: e.card, outStart, outDur, focus });
    cursorT = outStart + outDur;
  } else {
    const eIn = marks.get(`${e.id}:in`)!;
    const eOut = marks.get(`${e.id}:out`)!;
    if (eIn == null || eOut == null) throw new Error(`clip ${e.id} has no marks`);
    const inside = (kind: string) => events.filter((c) => c.kind === kind && c.e >= eIn - 0.05 && c.e < eOut);
    // Captions and callouts last until the next one (or a clear) or the end of the clip.
    const caps = inside('caption');
    const captions = caps
      .map((c, i) => ({ t0: Math.max(c.e, eIn), t1: (caps[i + 1]?.e ?? eOut) - 0.05, text: c.text as string | null }))
      .filter((c): c is { t0: number; t1: number; text: string } => !!c.text);
    const fs = inside('focus');
    const focus = fs
      .map((f, i) => ({ t0: f.e, t1: Math.min(fs[i + 1]?.e ?? eOut, eOut), rect: f.rect, sub: f.sub, label: f.label, underline: f.underline, pulse: f.pulse, below: f.below, clear: f.clear }))
      .filter((f) => !f.clear);
    items.push({ kind: 'clip', id: e.id, eIn, eOut, outStart, outDur: eOut - eIn, captions, focus });
    for (const v of inside('vo')) voPlacements.push({ id: v.id, at: outStart + (v.e - eIn) });
    cursorT = outStart + (eOut - eIn);
  }
}
const total = cursorT;
const nFrames = Math.ceil(total * FPS);
console.log(`edit: ${items.length} items, ${total.toFixed(2)} s, ${nFrames} frames, ${voPlacements.length} phrases`);
for (const it of items) console.log(`  ${(it.kind === 'clip' ? it.id : 'card ' + it.card).padEnd(14)} ${it.outStart.toFixed(2).padStart(7)}  ${it.outDur.toFixed(2)} s  ${it.focus.length} callouts`);
// Phrases must not overlap.
const sortedVo = [...voPlacements].sort((a, b) => a.at - b.at);
for (let i = 1; i < sortedVo.length; i++) {
  const prev = sortedVo[i - 1];
  if (prev.at + rec.voices[prev.id].dur > sortedVo[i].at + 0.02) console.warn(`overlap: ${prev.id} runs into ${sortedVo[i].id}`);
}

const edl = {
  view: rec.viewport,
  overlap: OVERLAP,
  items,
  inserts,
  frames: rec.frames,
  cams: events.filter((e) => e.kind === 'cam').map((e) => ({ ...e, t: e.e })),
  cursor: events.filter((e) => e.kind === 'cursor').map((e) => ({ t: e.e, x: e.x, y: e.y })),
  clicks: events.filter((e) => e.kind === 'click').map((e) => ({ t: e.e, x: e.x, y: e.y })),
};

// ---------- Frames ----------

const chunksDir = join(work, 'chunks');
rmSync(chunksDir, { recursive: true, force: true });
mkdirSync(chunksDir, { recursive: true });

// PREVIEW=12.5,40 renders just those output times to .cache/video/preview-<t>.png.
if (process.env.PREVIEW) {
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.route('**/__frame/*', (route) => {
    const name = route.request().url().split('/__frame/')[1];
    route.fulfill({ body: readFileSync(join(work, 'frames', name)), contentType: 'image/jpeg' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(base + 'scripts/video/render.html');
  await page.evaluate((e) => (window as any).setup(e), edl);
  for (const t of process.env.PREVIEW.split(',').map(Number)) {
    await page.evaluate((T) => (window as any).renderFrame(T), t);
    await page.screenshot({ path: join(work, `preview-${t}.png`) });
  }
  await browser.close();
  process.exit(0);
}

if (!process.env.SKIP_FRAMES) {
  const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
  const per = Math.ceil(nFrames / WORKERS);
  const t0 = Date.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async (_, w) => {
      const from = w * per;
      const to = Math.min(nFrames, from + per);
      if (from >= to) return;
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await ctx.route('**/__frame/*', (route) => {
        const name = route.request().url().split('/__frame/')[1];
        route.fulfill({ body: readFileSync(join(work, 'frames', name)), contentType: 'image/jpeg' });
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.error(`worker ${w}:`, e.message));
      await page.goto(base + 'scripts/video/render.html');
      await page.evaluate((e) => (window as any).setup(e), edl);
      const cdp = await ctx.newCDPSession(page);
      const ff = spawn('ffmpeg', [
        '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-r', String(FPS), '-g', String(FPS * 2), '-x264-params', 'keyint=120:min-keyint=60',
        join(chunksDir, `${String(w).padStart(2, '0')}.mp4`),
      ], { stdio: ['pipe', 'inherit', 'inherit'] });
      const finished = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${w} exited ${c}`)))));
      for (let f = from; f < to; f++) {
        await page.evaluate((T) => (window as any).renderFrame(T), f / FPS);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        if (!ff.stdin.write(Buffer.from(shot.data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
        done++;
        if (done % 600 === 0) console.log(`  ${done}/${nFrames} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      }
      ff.stdin.end();
      await finished;
      await ctx.close();
    }),
  );
  await browser.close();
  console.log(`frames rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const list = join(chunksDir, 'list.txt');
  writeFileSync(
    list,
    Array.from({ length: WORKERS }, (_, w) => `file '${join(chunksDir, `${String(w).padStart(2, '0')}.mp4`)}'`).join('\n'),
  );
  sh('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(work, 'video.mp4')]);
}

// ---------- Voice-over: placed, mixed, normalised to -16 LUFS ----------

const inputs: string[] = [];
const chains: string[] = [];
voPlacements.forEach((v, i) => {
  inputs.push('-i', rec.voices[v.id].file);
  const ms = Math.round(v.at * 1000);
  chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}:all=1[v${i}]`);
});
const mix = `${chains.join(';')};${voPlacements.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voPlacements.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[mix]`;
const rawAudio = join(work, 'vo-mix.wav');
sh('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', mix, '-map', '[mix]', '-ac', '1', '-ar', '48000', rawAudio]);
// loudnorm prints its measurement as JSON on stderr.
const measured = JSON.parse(
  execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${rawAudio}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'`], { encoding: 'utf8' }),
);
const audio = join(work, 'vo-16lufs.wav');
sh('ffmpeg', [
  '-loglevel', 'error', '-y', '-i', rawAudio,
  '-af',
  `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,aresample=48000`,
  '-ac', '2', '-ar', '48000', audio,
]);

// ---------- Mux ----------

sh('ffmpeg', [
  '-loglevel', 'error', '-y', '-i', join(work, 'video.mp4'), '-i', audio,
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-t', total.toFixed(3), '-movflags', '+faststart', out,
]);
const lufs = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${out}" -af ebur128 -f null - 2>&1 | grep -E '^ +I:' | tail -1`], { encoding: 'utf8' }).trim();
console.log(`demo: ${Number(ffprobe(out, 'format=duration')).toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(1)} MB, loudness ${lufs} -> ${out}`);

// ---------- Upload copy under 9.5 MB (two-pass) ----------

if (!process.env.SKIP_UPLOAD) {
  const limit = 9.5 * 1e6;
  // 720p: at the ~400 kb/s this size allows, 1080p smears during the camera moves; 720p stays clean.
  const height = Number(process.env.UPLOAD_HEIGHT ?? 720);
  const audioKbps = 96;
  let target = Math.floor(((limit * 0.94 * 8) / total) / 1000) - audioKbps;
  for (let attempt = 0; attempt < 4; attempt++) {
    const passlog = join(work, 'x264pass');
    const common = ['-i', out, '-vf', `scale=-2:${height}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', `${target}k`, '-maxrate', `${Math.round(target * 2)}k`, '-bufsize', `${target * 4}k`, '-pix_fmt', 'yuv420p', '-r', '30', '-tune', 'animation', '-passlogfile', passlog];
    sh('ffmpeg', ['-loglevel', 'error', '-y', ...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
    sh('ffmpeg', ['-loglevel', 'error', '-y', ...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-movflags', '+faststart', uploadOut]);
    const size = statSync(uploadOut).size;
    console.log(`upload copy: ${height}p, video ${target} kb/s -> ${(size / 1e6).toFixed(2)} MB`);
    if (size < limit) break;
    target = Math.floor(target * (limit * 0.97) / size);
  }
}
