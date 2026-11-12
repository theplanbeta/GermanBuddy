"""Generic scene renderer. engine: object with .sr and .say(item)->float32 audio, where item is a dict
{text, role, cues, kind:'speech'|'laugh'|'breath'} prepared by the model-specific plan() function.
Writes full WAV, per-paragraph WAVs + expected text (for ASR), and a JSON log with timings."""
import sys, os, json, time, resource
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np
from scene import paragraphs, segments, write_wav, stats, ascii_text

def plain_plan():
    # the text as written, one voice, one item per paragraph (sentence-split left to engine if needed)
    return [dict(para=i, role="narr", text=p, cues=set(), kind="speech", expect=p) for i, p in enumerate(paragraphs())]

def run(engine, items, out_wav, para_dir, log_path, gap_para=0.45, gap_inner=0.25, gap_pause=1.3):
    os.makedirs(para_dir, exist_ok=True)
    sr = engine.sr; pieces = []; per_para = {}; log = []; t_start = time.time(); first = None
    for k, it in enumerate(items):
        t0 = time.time(); a = np.asarray(engine.say(it), np.float32); dt = time.time() - t0
        if first is None: first = dict(compute_s=round(dt, 2), audio_s=round(len(a) / sr, 2), text=it["text"])
        nxt = items[k + 1] if k + 1 < len(items) else None
        g = gap_pause if "pause" in it.get("cues", ()) else (gap_inner if nxt is not None and nxt["para"] == it["para"] else gap_para)
        sil = np.zeros(int(g * sr), np.float32)
        pieces += [a, sil]
        per_para.setdefault(it["para"], []).append(a)
        os.makedirs(f"{para_dir}/items", exist_ok=True); write_wav(f"{para_dir}/items/p{k:03d}.wav", a, sr)
        log.append(dict(i=k, para=it["para"], role=it["role"], kind=it.get("kind"), text=it["text"], voice=it.get("voice"),
                        ctrl=it.get("ctrl"), compute_s=round(dt, 3), audio_s=round(len(a) / sr, 3)))
        print(f"[{k+1}/{len(items)}] {it['role']:6s} {dt:5.2f}s -> {len(a)/sr:5.2f}s  {it.get('ctrl','')} | {it['text'][:70]}", flush=True)
    total_compute = time.time() - t_start
    full = np.concatenate(pieces) if pieces else np.zeros(1, np.float32)
    raw_peak = write_wav(out_wav, full, sr)
    expect = {}
    for it in items:
        if it.get("expect"): expect.setdefault(it["para"], []).append(it["expect"])
    for p, chunks in per_para.items():
        z = np.zeros(int(0.25 * sr), np.float32)
        write_wav(f"{para_dir}/p{p:02d}.wav", np.concatenate(sum([[c, z] for c in chunks], [])), sr)
    json.dump({str(k): " ".join(v) for k, v in expect.items()}, open(f"{para_dir}/expect.json", "w"), indent=0)
    json.dump({str(k): it.get("expect") or "" for k, it in enumerate(items)}, open(f"{para_dir}/items/expect.json", "w"), indent=0)
    st = stats(full, sr)
    speech_audio = sum(x["audio_s"] for x in log)
    summary = dict(out=out_wav, sr=sr, total_compute_s=round(total_compute, 1), speech_audio_s=round(speech_audio, 1),
                   file_audio_s=st["dur"], rtf=round(total_compute / speech_audio, 3), first_chunk=first,
                   raw_peak_before_norm=round(raw_peak, 3), file_stats=st,
                   maxrss_mb=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
                   loadavg=os.getloadavg())
    json.dump(dict(summary=summary, items=log), open(log_path, "w"), indent=1)
    print(json.dumps(summary, indent=1))
    return summary
