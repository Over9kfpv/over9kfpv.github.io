#!/usr/bin/env python3
"""Align a known lyrics text file to a song's vocals.

demucs (vocal stem) -> faster-whisper (word timestamps) -> sequence-match the
known lyric words against the transcript words -> per-line start/end times.

Usage: align_lyrics.py <song.mp3> <lyrics.txt> -o lyrics.json [--work DIR]
Output: {"duration":..,"lines":[{"section","text","start","end","words":[{"w","start","end"}]}]}
"""
import argparse, json, os, re, subprocess, sys
from difflib import SequenceMatcher
from pathlib import Path


def norm(w):
    return re.sub(r"[^a-z0-9]", "", w.lower().replace("’", "'"))


def parse_lyrics(path):
    lines, section = [], ""
    for raw in Path(path).read_text().splitlines():
        s = raw.strip()
        if not s:
            continue
        m = re.fullmatch(r"\[(.+)\]", s)
        if m:
            section = m.group(1)
            continue
        lines.append({"section": section, "text": s})
    return lines


def separate_vocals(song, work):
    out = Path(work) / "htdemucs" / Path(song).stem / "vocals.wav"
    if not out.exists():
        subprocess.run([sys.executable, "-m", "demucs", "--two-stems", "vocals",
                        "-n", "htdemucs", "-o", str(work), str(song)], check=True)
    return out


_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel
        _MODEL = WhisperModel("large-v3", device="cuda", compute_type="float16")
    return _MODEL


def transcribe(vocals, prompt, work, mode="vad"):
    """mode 'vad': one pass with the VAD filter. mode 'chunked': no VAD, 30s windows
    with 5s overlap, so the model cannot go silent over long dense stretches."""
    cache = Path(work) / (Path(vocals).parent.name + ("" if mode == "vad" else "." + mode) + ".words.json")
    if cache.exists():
        return json.loads(cache.read_text())
    m = _model()
    if mode == "vad":
        segs, _ = m.transcribe(str(vocals), language="en", word_timestamps=True,
                               vad_filter=True, initial_prompt=prompt[:800],
                               condition_on_previous_text=False)
        words = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                 for s in segs for w in (s.words or [])]
    else:
        import soundfile as sf
        audio, sr = sf.read(str(vocals), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        import numpy as np
        from scipy.signal import resample_poly
        audio = resample_poly(audio, 16000, sr).astype(np.float32); sr = 16000
        win, hop, words = 30 * sr, 25 * sr, []
        for off in range(0, len(audio), hop):
            chunk = audio[off:off + win]
            if len(chunk) < sr:
                break
            segs, _ = m.transcribe(chunk, language="en", word_timestamps=True, vad_filter=False,
                                   initial_prompt=prompt[:800], condition_on_previous_text=False,
                                   no_speech_threshold=0.9)
            t0 = off / sr
            lo = t0 + (2.5 if off else 0)          # keep only the middle of each overlap
            hi = t0 + 27.5 if off + win < len(audio) else 1e9
            for s in segs:
                for w in (s.words or []):
                    st = t0 + w.start
                    if lo <= st < hi:
                        words.append({"w": w.word.strip(), "start": round(st, 3), "end": round(t0 + w.end, 3)})
    cache.write_text(json.dumps(words))
    return words


def merge(primary, extra):
    """Union of two transcripts; words from `extra` fill time where `primary` has none."""
    out = list(primary)
    for w in extra:
        if not any(p["start"] - 0.3 < w["start"] < p["end"] + 0.3 for p in primary):
            out.append(w)
    return sorted(out, key=lambda w: w["start"])


def align(lines, words, duration):
    lw = []  # (line_idx, word)
    for i, l in enumerate(lines):
        for w in l["text"].split():
            lw.append((i, w))
    a = [norm(w) for _, w in lw]
    b = [norm(w["w"]) for w in words]
    times = [None] * len(lw)
    for blk in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = (words[blk.b + k]["start"], words[blk.b + k]["end"])
    # Drop isolated matches of very common words (likely false anchors).
    for k, t in enumerate(times):
        if t and len(a[k]) <= 3:
            left = k > 0 and times[k - 1]
            right = k + 1 < len(times) and times[k + 1]
            if not left and not right:
                times[k] = None
    # Enforce monotonic anchors.
    last = -1.0
    for k, t in enumerate(times):
        if t:
            if t[0] < last:
                times[k] = None
            else:
                last = t[1]
    # Interpolate unmatched words between anchors.
    anchors = [k for k, t in enumerate(times) if t]
    if not anchors:
        raise SystemExit("no lyric words matched the transcript")
    n = len(times)
    for k in range(n):
        if times[k]:
            continue
        prev = max((j for j in anchors if j < k), default=None)
        nxt = min((j for j in anchors if j > k), default=None)
        if prev is None:
            t1 = times[nxt][0]; t0 = max(0.0, t1 - 0.4 * (nxt - k + 1))
            span_lo, cnt, pos = t0, nxt, k
            step = (t1 - t0) / max(1, nxt)
            s = t0 + step * k
        elif nxt is None:
            t0 = times[prev][1]
            s = min(duration - 0.5, t0 + 0.35 * (k - prev))
            step = 0.35
        else:
            t0, t1 = times[prev][1], times[nxt][0]
            step = (t1 - t0) / (nxt - prev)
            s = t0 + step * (k - prev - 1)
        times[k] = (round(s, 3), round(s + max(0.12, min(step, 0.6)), 3))
    out = []
    for i, l in enumerate(lines):
        ks = [k for k, (li, _) in enumerate(lw) if li == i]
        wds = [{"w": lw[k][1], "start": times[k][0], "end": times[k][1],
                "matched": k in anchors} for k in ks]
        out.append({**l, "start": wds[0]["start"], "end": wds[-1]["end"],
                    "matched": sum(w["matched"] for w in wds) / len(wds), "words": wds})
    return out, len(anchors) / n


def refine_onsets(aligned, vocals):
    """Whisper stretches a word's start back over the preceding pause. Snap each word's
    start (and each line's last word end) to where the vocal stem actually has energy."""
    import numpy as np, soundfile as sf
    audio, sr = sf.read(str(vocals), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    hop = int(sr * 0.01)
    n = len(audio) // hop
    rms = np.sqrt((audio[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    floor = np.percentile(rms, 30)
    fr = lambda t: max(0, min(n - 1, int(t * 100)))
    for line in aligned:
        for i, w in enumerate(line["words"]):
            a, b = fr(w["start"]), fr(w["end"])
            if b - a < 3:
                continue
            seg = rms[a:b]
            thr = max(floor * 2, seg.max() * 0.3)
            on = np.argmax(seg > thr)
            # never push past 80% of the word, keep at least 80ms of word
            new = min(w["start"] + on / 100, w["end"] - 0.08, w["start"] + 0.8 * (w["end"] - w["start"]))
            w["start"] = round(max(w["start"], new), 3)
        last = line["words"][-1]
        a, b = -1, -1  # line-end trimming handled via onsets below
        if b - a >= 3:
            seg = rms[a:b]
            thr = max(floor * 2, seg.max() * 0.2)
            idx = np.nonzero(seg > thr)[0]
            if len(idx):
                last["end"] = round(max(last["start"] + 0.12, last["start"] + (idx[-1] + 1) / 100 + (a - fr(last["start"])) / 100), 3)
        line["start"], line["end"] = line["words"][0]["start"], line["words"][-1]["end"]
    # Whisper parks a line's first word inside the pause before it. Find a silent stretch
    # (>=120ms) in that word's window and snap the start to where the voice comes back.
    def reentry(t0, t1):
        a, b = fr(t0), fr(t1)
        if b - a < 5:
            return None
        seg = rms[a:b]
        loud = max(seg.max(), 1e-6)
        quiet = seg < max(floor * 1.5, loud * 0.08)
        best, run = None, 0
        for k in range(len(seg)):
            if quiet[k]:
                run += 1
            else:
                if run >= 12:
                    best = k
                run = 0
        return None if best is None else t0 + best / 100

    for i, line in enumerate(aligned):
        w = line["words"]
        limit = w[1]["start"] + 0.3 if len(w) > 1 else w[0]["end"] + 0.5
        t = reentry(w[0]["start"], max(w[0]["end"] + 0.3, limit))
        if t is not None and t > w[0]["start"] + 0.1:
            shift = t - w[0]["start"]
            w[0]["start"] = round(t, 3)
            w[0]["end"] = round(max(w[0]["end"], t + 0.12), 3)
            # later words that were squeezed into the pause move up behind it
            for k in range(1, len(w)):
                if w[k]["start"] < w[k - 1]["start"] + 0.08:
                    w[k]["start"] = round(w[k - 1]["start"] + 0.12, 3)
                    w[k]["end"] = round(max(w[k]["end"], w[k]["start"] + 0.12), 3)
            if i and aligned[i - 1]["end"] > t:
                aligned[i - 1]["end"] = round(t - 0.05, 3)
        line["start"], line["end"] = w[0]["start"], max(line["end"], w[-1]["end"]) if False else w[-1]["end"]
    return aligned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song"); ap.add_argument("lyrics")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--work", default=os.path.expanduser("~/.cache/lyricsync"))
    args = ap.parse_args()
    Path(args.work).mkdir(parents=True, exist_ok=True)
    import soundfile as sf
    duration = sf.info(args.song).duration
    lines = parse_lyrics(args.lyrics)
    vocals = separate_vocals(args.song, args.work)
    prompt = " ".join(l["text"] for l in lines)
    words = transcribe(vocals, prompt, args.work)
    aligned, ratio = align(lines, words, duration)
    if ratio < 0.9:
        chunked = transcribe(vocals, prompt, args.work, mode="chunked")
        for name, cand in (("chunked", chunked), ("merged", merge(words, chunked))):
            a2, r2 = align(lines, cand, duration)
            print(f"  {name}: {r2:.0%}")
            if r2 > ratio:
                aligned, ratio = a2, r2
    aligned = refine_onsets(aligned, vocals)
    Path(args.out).write_text(json.dumps({"duration": round(duration, 3), "match_ratio": round(ratio, 3),
                                          "lines": aligned}, indent=1))
    print(f"{len(aligned)} lines, {ratio:.0%} of lyric words anchored to transcript -> {args.out}")


if __name__ == "__main__":
    main()
