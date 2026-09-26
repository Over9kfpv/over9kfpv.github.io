// "subtitles" layout: a transparent overlay (render as WebM/MOV) with the lyrics as a
// subtitle band along the bottom, so a live camera can show through everything above it.
export function subtitlesHTML({ data, cfg, D, esc }) {
  return `<!doctype html>
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
      :root { --text: #f6f1f8; --muted: #cfc4d8; --accent: #ff5500; --gold: #ffc53d;
        --sun: linear-gradient(90deg, #ffc53d 0%, #ff5500 55%, #ff2e88 100%); }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
      #root { width: 100%; height: 100%; position: relative; overflow: hidden;
        font-family: "Space Grotesk", sans-serif; color: var(--text); }
      .layer { position: absolute; inset: 0; }
      #scrim { position: absolute; left: 0; right: 0; bottom: 0; height: 360px;
        background: linear-gradient(180deg, rgba(12,8,18,0) 0%, rgba(12,8,18,0.55) 45%, rgba(12,8,18,0.82) 100%); }

      #chip { position: absolute; left: 80px; bottom: 214px; display: flex; align-items: center; gap: 18px; }
      #thumb-slot { width: 76px; height: 76px; flex: none; }
      #thumb { display: block; width: 76px; height: 76px; border-radius: 8px; object-fit: cover;
        box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.12); }
      #chip-text { display: flex; flex-direction: column; gap: 4px; }
      #c-title { font-weight: 700; font-size: 30px; line-height: 1.1; text-shadow: 0 2px 10px rgba(0,0,0,0.6); }
      #c-meta { font-family: "JetBrains Mono", monospace; font-weight: 700; font-size: 18px;
        letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); text-shadow: 0 2px 8px rgba(0,0,0,0.6); }

      #subs { position: absolute; left: 160px; right: 160px; bottom: 74px; height: 128px; }
      .line { position: absolute; left: 0; right: 0; bottom: 0; text-align: center; font-weight: 700;
        font-size: 54px; line-height: 1.18; letter-spacing: -0.01em; opacity: 0;
        text-shadow: 0 3px 14px rgba(0,0,0,0.75), 0 0 2px rgba(0,0,0,0.9); }
      .line.long { font-size: 46px; }
      .line.xlong { font-size: 40px; }
      .line.inst { color: var(--gold); letter-spacing: 0.4em; }
      .w { display: inline-block; opacity: 0.45; }

      #eq { position: absolute; left: 50%; bottom: 0; width: 720px; height: 110px; margin-left: -360px;
        display: flex; align-items: flex-end; justify-content: space-between; }
      .bar { display: block; width: 22px; height: 110px; border-radius: 4px 4px 1px 1px; transform-origin: 50% 100%;
        background: linear-gradient(180deg, #ffe38a 0%, #ffc53d 25%, #ff5500 60%, #ff2e88 100%);
        box-shadow: 0 0 14px rgba(255,85,0,0.35); }
      #progress { position: absolute; left: 80px; right: 80px; bottom: 40px; height: 4px;
        background: rgba(255,255,255,0.18); border-radius: 2px; }
      #bar { width: 100%; height: 4px; background: var(--sun); border-radius: 2px; transform-origin: 0% 50%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="1920" data-height="1080">
      <div id="overlay" class="layer clip" data-start="0" data-duration="${D}" data-track-index="0">
        <div id="band">
          <div id="scrim"></div>
          <div id="chip">
            <div id="thumb-slot"><img id="thumb" src="assets/art.webp" alt="" /></div>
            <div id="chip-text"><div id="c-title">${esc(cfg.title)}</div><div id="c-meta">${esc(cfg.band)} · ${esc(cfg.subtitle || "")}</div></div>
          </div>
          <div id="subs" data-layout-allow-overlap></div>
          <div id="progress"><div id="bar"></div></div>
        </div>
      </div>
      <audio id="bgm" src="assets/bgm.mp3" data-start="0" data-duration="${D}" data-track-index="11" data-volume="1"></audio>
    </div>
    <script>
      const DATA = ${JSON.stringify(data)};
      const subs = document.getElementById("subs");
      const lineEls = DATA.lines.map((l) => {
        const el = document.createElement("div");
        const len = l.words.reduce((n, w) => n + w[0].length + 1, 0);
        el.setAttribute("data-layout-allow-overlap", "");
        el.className = "line" + (l.inst ? " inst" : "") + (len > 70 ? " xlong" : len > 48 ? " long" : "");
        if (l.inst) el.textContent = "♪ ♪ ♪";
        else l.words.forEach((w, i) => {
          const s = document.createElement("span");
          s.className = "w"; s.textContent = w[0]; el.appendChild(s);
          if (i < l.words.length - 1) el.appendChild(document.createTextNode(" "));
        });
        subs.appendChild(el);
        return el;
      });

      // Instrumental: an equalizer in place of the subtitle line.
      const bars = [];
      if (!DATA.lines.length) {
        const eq = document.createElement("div");
        eq.id = "eq";
        for (let i = 0; i < 24; i++) { const b = document.createElement("div"); b.className = "bar"; eq.appendChild(b); bars.push(b); }
        subs.appendChild(eq);
      }
      // Deterministic per-(hit, bar) jitter so bars in a band don't move in lockstep.
      const jitter = (h, i) => { const x = Math.sin(h * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };

      document.fonts.ready.then(() => {
        const D = DATA.D, tl = gsap.timeline({ paused: true });
        // Band in / out.
        tl.fromTo("#band", { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power1.out" }, 0.2);
        tl.fromTo("#band", { opacity: 1 }, { opacity: 0, duration: 1.2, ease: "power1.in", immediateRender: false }, D - 1.4);
        tl.fromTo("#bar", { scaleX: 0 }, { scaleX: 1, duration: D, ease: "none" }, 0);

        // One subtitle line at a time: in just before it is sung, out when the next arrives
        // (or after a short hold if the singer pauses).
        const IN = 0.25, FADE = 0.22;
        DATA.lines.forEach((l, i) => {
          const at = Math.max(0.3, l.start - IN);
          const next = DATA.lines[i + 1];
          const nextAt = next ? Math.max(0.3, next.start - IN) : D - 1.4;
          const hold = l.inst ? nextAt : Math.min(nextAt, (l.end || l.start) + 1.6);
          // Fade out once the line is fully in: at the hold point, or as the next line arrives.
          const outAt = Math.max(at + FADE, Math.min(hold, nextAt - 0.05));
          tl.fromTo(lineEls[i], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: FADE, ease: "power2.out", immediateRender: false }, at);
          tl.fromTo(lineEls[i], { opacity: 1, y: 0 }, { opacity: 0, y: -10, duration: FADE, ease: "power2.in", immediateRender: false }, outAt);
          const spans = lineEls[i].querySelectorAll(".w");
          l.words.forEach((w, k) => {
            tl.fromTo(spans[k], { opacity: 0.45 }, { opacity: 1, duration: Math.max(0.08, Math.min(0.18, w[2] - w[1])), ease: "power2.out", immediateRender: false }, w[1]);
          });
        });
        lineEls.forEach((el) => gsap.set(el, { opacity: 0 }));

        if (bars.length) {
          const REST = 0.08;
          gsap.set(bars, { scaleY: REST });
          DATA.hits.forEach(([t, band, e], h) => {
            if (t > D - 1.5) return;
            const group = bars.slice(band * 8, band * 8 + 8);
            tl.fromTo(group, { scaleY: (i) => Math.min(1, REST + Math.pow(e, 0.5) * (0.6 + 0.4 * jitter(h, i))) },
              { scaleY: REST, duration: band === 2 ? 0.22 : 0.4, ease: "power2.out", immediateRender: false }, t);
          });
        }

        // Beat pulses on the cover thumbnail.
        DATA.pulses.forEach(([t, e]) => {
          if (t > D - 1.5) return;
          tl.fromTo("#thumb-slot", { scale: 1 + 0.06 * e }, { scale: 1, duration: 0.35, ease: "power2.out", immediateRender: false }, t);
        });

        window.__timelines["main"] = tl;
        if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
      });
    </script>
  </body>
</html>
`;
}
