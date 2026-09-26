#!/usr/bin/env node
// Build the lyric-video composition (index.html) for one song.
// Usage: node build.mjs <album-track-number>   (Songs for Fallen Drones, metadata from tracks.js)
//        node build.mjs <project-dir>          (any song; metadata from <project-dir>/video.json)
// Expects <project>/{lyrics.json,audiomap.json,assets/bgm.mp3} to exist.
// video.json: {title, band, art, kicker, metaLeft, metaRight, outroKicker, outroBy}
//   or {layout: "subtitles", title, band, subtitle, art} for a transparent bottom-subtitle overlay
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { subtitlesHTML } from "./subtitles-template.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const album = join(here, "..", "..");
const arg = process.argv[2];
if (!arg) throw new Error("usage: build.mjs <track-number | project-dir>");

let dir, cfg;
if (/^\d+$/.test(arg)) {
  const n = Number(arg);
  const win = {};
  new Function("window", readFileSync(join(album, "tracks.js"), "utf8"))(win);
  const track = win.TRACKS.find((t) => t.n === n);
  const nn = String(n).padStart(2, "0");
  dir = join(album, "videos", basename(track.src, ".mp3"));
  cfg = {
    title: track.title, band: track.band, art: join(album, track.art),
    kicker: `Track ${nn} · Songs for Fallen Drones`,
    metaLeft: "Songs for Fallen Drones", metaRight: `<b>${nn}</b> / 12`,
    outroKicker: "Songs for Fallen Drones", outroBy: "over9kfpv.github.io",
  };
} else {
  dir = resolve(arg);
  cfg = JSON.parse(readFileSync(join(dir, "video.json"), "utf8"));
  cfg.art = resolve(dir, cfg.art);
}
const projectName = basename(dir);

const lyrics = JSON.parse(readFileSync(join(dir, "lyrics.json"), "utf8"));
const audiomap = JSON.parse(readFileSync(join(dir, "audiomap.json"), "utf8"));
const D = Math.round(audiomap.audio.duration_sec * 1000) / 1000;

// Shared assets: fonts + gsap (local, no render-time network).
mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
const shared = join(album, "videos", "_shared");
for (const f of readdirSync(join(shared, "fonts"))) copyFileSync(join(shared, "fonts", f), join(dir, "assets", "fonts", f));
copyFileSync(cfg.art, join(dir, "assets", "art.webp"));

// ---- Timing data ---------------------------------------------------------
const INSTRUMENTAL_GAP = 7; // seconds of no vocals before we show a ••• marker
const lines = [];
let prevEnd = 0;
for (const l of lyrics.lines) {
  if (l.start - prevEnd > INSTRUMENTAL_GAP && lines.length) {
    lines.push({ inst: true, start: +(prevEnd + 1.2).toFixed(3), words: [] });
  }
  lines.push({
    section: l.section,
    start: l.words[0].start,
    end: l.end,
    words: l.words.map((w) => [w.w, w.start, w.end]),
  });
  prevEnd = Math.max(prevEnd, l.end);
}
const firstStart = lines[0].start;
const lastEnd = prevEnd;

// Beat pulses: strong-grid kicks with real energy, thinned to >= 0.4s apart.
const pulses = [];
const kickE = audiomap.events.filter((e) => e.drum === "kick").map((e) => e.energy).sort((a, b) => a - b);
const kickThr = Math.max(0.05, kickE[Math.floor(kickE.length * 0.6)] ?? 0.25); // top 40% of this track's kicks
for (const e of audiomap.events) {
  if (e.drum === "kick" && e.energy >= kickThr) {
    if (!pulses.length || e.t - pulses[pulses.length - 1][0] >= 0.4) pulses.push([+e.t.toFixed(3), Math.min(1, 0.5 + e.energy / (2 * kickE[kickE.length - 1]))]);
  }
}
const surges = audiomap.key_moments.filter((k) => k.kind === "SURGE").map((k) => k.t);

const data = { D, firstStart, lastEnd, lines, pulses, surges };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/fonts/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Space Grotesk"; font-weight: 700; src: url("assets/fonts/space-grotesk-latin-700-normal.woff2") format("woff2"); }
      @font-face { font-family: "Space Grotesk"; font-weight: 500; src: url("assets/fonts/space-grotesk-latin-500-normal.woff2") format("woff2"); }
      @font-face { font-family: "JetBrains Mono"; font-weight: 500; src: url("assets/fonts/jetbrains-mono-latin-500-normal.woff2") format("woff2"); }
      @font-face { font-family: "JetBrains Mono"; font-weight: 700; src: url("assets/fonts/jetbrains-mono-latin-700-normal.woff2") format("woff2"); }
      :root {
        --bg: #0c0812; --text: #f6f1f8; --muted: #b3a6bd; --accent: #ff5500;
        --gold: #ffc53d; --pink: #ff2e88;
        --sun: linear-gradient(180deg, #ffe38a 0%, #ffc53d 22%, #ff5500 55%, #ff2e88 100%);
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); }
      #root { width: 100%; height: 100%; position: relative; overflow: hidden; background: var(--bg);
        font-family: "Space Grotesk", sans-serif; color: var(--text); }
      .layer { position: absolute; inset: 0; }

      /* background: the track art, blurred into a colour field */
      #bg-wrap { overflow: hidden; }
      #bg-img { position: absolute; inset: -8%; width: 116%; height: 116%; object-fit: cover;
        filter: blur(48px) saturate(1.35) brightness(0.42); }
      #shade { background:
        radial-gradient(ellipse at 28% 50%, rgba(12,8,18,0) 0%, rgba(12,8,18,0.35) 55%, rgba(12,8,18,0.85) 100%),
        linear-gradient(90deg, rgba(12,8,18,0.1) 0%, rgba(12,8,18,0.55) 55%, rgba(12,8,18,0.75) 100%); }
      #scan { background: repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 2px, rgba(0,0,0,0) 2px 4px); opacity: 0.5; }
      #flash { background: radial-gradient(ellipse at 30% 50%, rgba(255,85,0,0.35), rgba(255,46,136,0) 60%); opacity: 0; }

      /* art card */
      #card-slot { position: absolute; left: 120px; top: 150px; width: 720px; height: 720px; }
      #card { width: 100%; height: 100%; border-radius: 10px; overflow: hidden; position: relative;
        box-shadow: 0 40px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08); }
      #card-img { display: block; width: 100%; height: 100%; object-fit: cover; }
      #card-glow { position: absolute; inset: -30px; border-radius: 40px; opacity: 0;
        box-shadow: 0 0 80px 10px rgba(255,85,0,0.55); }
      #meta { position: absolute; left: 120px; top: 900px; width: 720px; display: flex;
        justify-content: space-between; align-items: baseline;
        font-family: "JetBrains Mono", monospace; font-weight: 500; font-size: 22px;
        letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
      #meta b { color: var(--gold); font-weight: 700; }

      /* right panel */
      #panel { position: absolute; left: 960px; top: 0; width: 860px; height: 1080px; }
      #head { position: absolute; left: 0; top: 150px; width: 860px; }
      #band { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 22px;
        letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
      #title { margin-top: 10px; font-weight: 700; font-size: 40px; line-height: 1.1; letter-spacing: -0.01em; }
      #section { position: absolute; left: 0; top: 300px; height: 40px; width: 860px; }
      .sec { position: absolute; left: 0; top: 0; font-family: "JetBrains Mono", monospace; font-weight: 700;
        font-size: 18px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--bg);
        background: var(--gold); padding: 6px 12px; border-radius: 4px; opacity: 0; }
      #viewport { position: absolute; left: 0; top: 360px; width: 860px; height: 520px; overflow: hidden;
        -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 22%, #000 70%, transparent 100%);
                mask-image: linear-gradient(180deg, transparent 0%, #000 22%, #000 70%, transparent 100%); }
      #scroller { position: absolute; left: 0; top: 0; width: 860px; }
      .line { display: block; width: 860px; padding: 14px 0; font-weight: 700; font-size: 62px;
        line-height: 1.26; letter-spacing: -0.015em; transform-origin: 0% 50%; opacity: 0.32; }
      .line.long { font-size: 50px; line-height: 1.32; }
      .line.xlong { font-size: 42px; line-height: 1.34; }
      .w { display: inline-block; opacity: 0.35; }
      .line.inst { color: var(--accent); letter-spacing: 0.3em; }
      #progress { position: absolute; left: 0; top: 940px; width: 860px; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; }
      #bar { width: 860px; height: 4px; background: var(--sun); border-radius: 2px; transform-origin: 0% 50%; }
      #times { position: absolute; left: 0; top: 956px; width: 860px; display: flex; justify-content: space-between;
        font-family: "JetBrains Mono", monospace; font-weight: 500; font-size: 18px; color: var(--muted); }

      /* intro + outro cards */
      #intro, #outro { display: flex; flex-direction: column; justify-content: center; padding-left: 960px; padding-right: 100px; }
      #intro .kicker, #outro .kicker { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 22px;
        letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold); }
      #intro .big { margin-top: 18px; font-weight: 700; font-size: 96px; line-height: 0.98; letter-spacing: -0.03em;
        background: var(--sun); -webkit-background-clip: text; background-clip: text; color: transparent; }
      #intro .by { margin-top: 26px; font-weight: 500; font-size: 34px; color: var(--text); }
      #outro .big { margin-top: 18px; font-weight: 700; font-size: 72px; line-height: 1; letter-spacing: -0.02em; }
      #outro .by { margin-top: 22px; font-family: "JetBrains Mono", monospace; font-weight: 500; font-size: 24px; color: var(--muted); }
      #intro-in, #outro-in { opacity: 0; }
      #fade { background: #000; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="1920" data-height="1080">
      <div id="bg-wrap" class="layer clip" data-start="0" data-duration="${D}" data-track-index="0">
        <img id="bg-img" src="assets/art.webp" alt="" />
      </div>
      <div id="shade" class="layer clip" data-start="0" data-duration="${D}" data-track-index="1"></div>
      <div id="flash" class="layer clip" data-start="0" data-duration="${D}" data-track-index="2"></div>

      <div id="stage" class="layer clip" data-start="0" data-duration="${D}" data-track-index="3">
        <div id="card-slot">
          <div id="card-glow"></div>
          <div id="card"><img id="card-img" src="assets/art.webp" alt="" /></div>
        </div>
        <div id="meta"><span>${esc(cfg.metaLeft)}</span><span>${cfg.metaRight}</span></div>
        <div id="panel">
          <div id="lyr">
            <div id="head"><div id="band">${esc(cfg.band)}</div><div id="title">${esc(cfg.title)}</div></div>
            <div id="section"></div>
            <div id="viewport"><div id="scroller" data-layout-allow-overflow></div></div>
          </div>
          <div id="progress"><div id="bar"></div></div>
          <div id="times"><span id="t-now">0:00</span><span>${Math.floor(D / 60)}:${String(Math.floor(D % 60)).padStart(2, "0")}</span></div>
        </div>
      </div>

      <div id="intro" class="layer clip" data-start="0" data-duration="${D}" data-track-index="4">
        <div id="intro-in">
          <div class="kicker">${esc(cfg.kicker)}</div>
          <div class="big">${esc(cfg.title)}</div>
          <div class="by">${esc(cfg.band)}</div>
        </div>
      </div>
      <div id="outro" class="layer clip" data-start="0" data-duration="${D}" data-track-index="5">
        <div id="outro-in">
          <div class="kicker">${esc(cfg.outroKicker)}</div>
          <div class="big">${esc(cfg.title)}</div>
          <div class="by">${esc(cfg.outroBy)}</div>
        </div>
      </div>
      <div id="scan" class="layer clip" data-start="0" data-duration="${D}" data-track-index="6"></div>
      <div id="fade" class="layer clip" data-start="0" data-duration="${D}" data-track-index="7"></div>

      <audio id="bgm" src="assets/bgm.mp3" data-start="0" data-duration="${D}" data-track-index="11" data-volume="1"></audio>
    </div>
    <script>
      const DATA = ${JSON.stringify(data)};
      const scroller = document.getElementById("scroller");
      const sectionBox = document.getElementById("section");

      // Static DOM for every line and word.
      const lineEls = DATA.lines.map((l) => {
        const el = document.createElement("div");
        const len = l.words.reduce((n, w) => n + w[0].length + 1, 0);
        el.className = "line" + (l.inst ? " inst" : "") + (len > 70 ? " xlong" : len > 48 ? " long" : "");
        if (l.inst) el.textContent = "• • •";
        else l.words.forEach((w, i) => {
          const s = document.createElement("span");
          s.className = "w";
          s.textContent = w[0];
          el.appendChild(s);
          if (i < l.words.length - 1) el.appendChild(document.createTextNode(" "));
        });
        scroller.appendChild(el);
        return el;
      });

      // Section chips (one per contiguous section run).
      const sections = [];
      DATA.lines.forEach((l) => {
        if (l.inst) return;
        const last = sections[sections.length - 1];
        if (!last || last.name !== l.section) sections.push({ name: l.section, start: l.start });
      });
      const secEls = sections.map((s) => {
        const el = document.createElement("div");
        el.className = "sec";
        el.textContent = s.name || "";
        sectionBox.appendChild(el);
        return el;
      });

      const fmt = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");

      document.fonts.ready.then(() => {
        const D = DATA.D;
        const tl = gsap.timeline({ paused: true });
        const VIEW_H = 520, ANCHOR = VIEW_H * 0.42;

        // Global in/out fade.
        tl.fromTo("#fade", { opacity: 1 }, { opacity: 0, duration: 1.0, ease: "power1.out" }, 0);
        tl.fromTo("#fade", { opacity: 0 }, { opacity: 1, duration: 1.6, ease: "power1.in", immediateRender: false }, D - 1.6);

        // Slow drift of the background and Ken Burns on the card.
        tl.fromTo("#bg-img", { scale: 1.0, x: -20 }, { scale: 1.12, x: 20, duration: D, ease: "none" }, 0);
        tl.fromTo("#card-img", { scale: 1.0 }, { scale: 1.08, duration: D, ease: "none" }, 0);

        // Progress bar + clock (seek-safe: derived from tween progress).
        const clock = document.getElementById("t-now");
        tl.fromTo("#bar", { scaleX: 0 }, { scaleX: 1, duration: D, ease: "none",
          onUpdate() { clock.textContent = fmt(this.progress() * D); } }, 0);

        // Intro card, visible until just before the first vocal.
        const introOut = Math.max(2.2, DATA.firstStart - 0.6);
        tl.fromTo("#intro-in", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, 0.4);
        tl.fromTo("#lyr", { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0);
        tl.fromTo("#intro-in", { opacity: 1, y: 0 }, { opacity: 0, y: -24, duration: 0.5, ease: "power2.in", immediateRender: false }, introOut - 0.5);
        tl.fromTo("#lyr", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out", immediateRender: false }, introOut - 0.1);

        // Outro card after the last vocal.
        const outroIn = Math.min(D - 5, DATA.lastEnd + 1.5);
        if (outroIn > DATA.lastEnd) {
          tl.fromTo("#lyr", { opacity: 1 }, { opacity: 0, duration: 0.6, ease: "power2.in", immediateRender: false }, outroIn - 0.6);
          tl.fromTo("#outro-in", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", immediateRender: false }, outroIn);
        }

        // Scroll the lyric column: line i centred on its start time.
        const centerY = lineEls.map((el) => el.offsetTop + el.offsetHeight / 2);
        let prevY = ANCHOR - centerY[0];
        gsap.set(scroller, { y: prevY });
        DATA.lines.forEach((l, i) => {
          const at = Math.max(0, l.start - 0.3);
          const next = DATA.lines[i + 1];
          const dur = Math.min(0.45, next ? Math.max(0.15, next.start - l.start) : 0.45);
          const y = ANCHOR - centerY[i];
          if (i > 0) tl.fromTo(scroller, { y: prevY }, { y, duration: dur, ease: "power3.out", immediateRender: false }, at);
          prevY = y;
          // Line focus: in at start, out when the next line takes over.
          tl.fromTo(lineEls[i], { opacity: 0.32, scale: 0.92 }, { opacity: 1, scale: 1, duration: dur, ease: "power2.out", immediateRender: false }, at);
          if (next) tl.fromTo(lineEls[i], { opacity: 1, scale: 1 }, { opacity: 0.32, scale: 0.92, duration: 0.4, ease: "power2.out", immediateRender: false }, Math.max(at + dur, next.start - 0.3));
          // Words light up as they are sung.
          const spans = lineEls[i].querySelectorAll(".w");
          l.words.forEach((w, k) => {
            tl.fromTo(spans[k], { opacity: 0.35 }, { opacity: 1, duration: Math.max(0.08, Math.min(0.18, w[2] - w[1])), ease: "power2.out", immediateRender: false }, w[1]);
          });
        });
        lineEls.forEach((el) => gsap.set(el, { opacity: 0.32, scale: 0.92 }));

        // Section chip swaps.
        sections.forEach((s, i) => {
          const at = Math.max(0, s.start - 0.3);
          tl.fromTo(secEls[i], { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.35, ease: "power3.out", immediateRender: false }, at);
          const nx = sections[i + 1];
          const end = nx ? nx.start - 0.35 : DATA.lastEnd + 0.8;
          tl.fromTo(secEls[i], { opacity: 1 }, { opacity: 0, duration: 0.25, ease: "power1.in", immediateRender: false }, Math.max(at + 0.35, end));
        });

        // Beat pulses on the art card; flashes on energy surges.
        DATA.pulses.forEach(([t, e]) => {
          if (t > D - 0.5) return;
          tl.fromTo("#card-slot", { scale: 1 + 0.025 * e }, { scale: 1, duration: 0.38, ease: "power2.out", immediateRender: false }, t);
          tl.fromTo("#card-glow", { opacity: 0.8 * e }, { opacity: 0, duration: 0.45, ease: "power2.out", immediateRender: false }, t);
        });
        DATA.surges.forEach((t) => {
          if (t > D - 1) return;
          tl.fromTo("#flash", { opacity: 1 }, { opacity: 0, duration: 1.2, ease: "power2.out", immediateRender: false }, t);
        });

        window.__timelines["main"] = tl;
        if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
      });
    </script>
  </body>
</html>
`;
writeFileSync(join(dir, "index.html"), cfg.layout === "subtitles" ? subtitlesHTML({ data, cfg, D, esc }) : html);
console.log(`built ${projectName}/index.html · ${D}s · ${lines.length} lines · ${pulses.length} pulses`);
