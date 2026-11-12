"""Playback-buffer simulation for call-size policies.
Per sentence: phonemes n, audio seconds (speech + its pause) from the D1 ablation logs.
A call's preparation time = (seconds of audio it synthesises, including any look-ahead) / prep speed
+ a fixed 0.15 s per call. Playback starts when the first sentence is ready; a stall happens when
playback reaches a sentence that is not ready yet. Reported over the first 60 s of audio."""
import json, sys
RATE = 12.5  # phonemes per second of speech (measured)
def load(f):
    d = json.load(open(f))["sentences"]
    return [{"n": s["n"], "sec": s["dur"] + s["silenceAfter"], "para": s["design"] >= 0.8} for s in d]
def plan(S, policy, la):
    """policy: 'd3' = first alone, then paragraph calls <=480 ph; 'ramp' = 1,2,4 sentences then <=480 ph.
    la: 'full' | 'w2' (2 words, ~8 phonemes) | 'none'. Returns calls: (list of sentence idx, extra look-ahead phonemes)."""
    calls, i, sizes = [], 0, ([1, 2, 4] if policy == "ramp" else [1])
    while i < len(S):
        cap = sizes[len(calls)] if len(calls) < len(sizes) else 99
        g = [i]; ph = S[i]["n"]
        while len(g) < cap and not S[g[-1]]["para"] and g[-1] + 1 < len(S) and ph + S[g[-1] + 1]["n"] + 1 <= 480:
            g.append(g[-1] + 1); ph += S[g[-1]]["n"] + 1
        nxt = g[-1] + 1
        extra = 0
        if not S[g[-1]]["para"] and nxt < len(S):
            if la == "full" and ph + S[nxt]["n"] <= 505: extra = S[nxt]["n"]
            elif la == "w2": extra = 10
        calls.append((g, extra)); i = nxt
    return calls
def simulate(S, calls, prep, horizon=60.0):
    t, ready = 0.0, {}
    for g, extra in calls:
        secs = sum(S[k]["sec"] for k in g) + extra / RATE
        t += 0.15 + secs / prep
        for k in g: ready[k] = t
    play, stalls, worst, first = None, 0, 0.0, ready[0]
    clock = first; heard = 0.0
    for k in range(len(S)):
        if heard >= horizon: break
        if ready[k] > clock: stalls += 1; worst = max(worst, ready[k] - clock); clock = ready[k]
        clock += S[k]["sec"]; heard += S[k]["sec"]
    return first, stalls, worst
def adaptive(S, prep, la, horizon=60.0):
    """App-side policy: the next call is the largest group (<=480 ph, same paragraph) whose preparation
    fits in the audio already buffered ahead of the listener; at least one sentence."""
    t, i, ready, buffered_until, calls = 0.0, 0, {}, None, []
    while i < len(S):
        g = [i]; ph = S[i]["n"]
        def cost(gg, ph_):
            nxt = gg[-1] + 1; extra = 0
            if not S[gg[-1]]["para"] and nxt < len(S): extra = S[nxt]["n"] if la == "full" else 10
            return 0.15 + (sum(S[k]["sec"] for k in gg) + extra / RATE) / prep
        while not S[g[-1]]["para"] and g[-1] + 1 < len(S) and ph + S[g[-1] + 1]["n"] + 1 <= 480:
            cand = g + [g[-1] + 1]
            budget = (buffered_until - t) if buffered_until is not None else 0
            if cost(cand, 0) > budget: break
            g = cand; ph += S[g[-1]]["n"] + 1
        t += cost(g, 0)
        for k in g: ready[k] = t
        start = ready[0] if buffered_until is None else None
        # playback position: sum of audio of all sentences before; buffered_until = when the buffer runs dry
        if buffered_until is None: buffered_until = t
        buffered_until = max(buffered_until, t) + sum(S[k]["sec"] for k in g)
        calls.append(len(g)); i = g[-1] + 1
    clock = ready[0]; heard = 0; stalls = 0; worst = 0
    for k in range(len(S)):
        if heard >= horizon: break
        if ready[k] > clock: stalls += 1; worst = max(worst, ready[k] - clock); clock = ready[k]
        clock += S[k]["sec"]; heard += S[k]["sec"]
    return ready[0], stalls, worst, calls
for f in sys.argv[1:]:
    S = load(f); print(f"== {f}  ({len(S)} sentences, {sum(s['sec'] for s in S):.0f} s)")
    for name, pol, la in [("a D3 (first alone + full look-ahead)", "d3", "full"), ("b ramp 1-2-4-max + full look-ahead", "ramp", "full"), ("c ramp + 2-word look-ahead", "ramp", "w2"), ("  D3 with 2-word look-ahead", "d3", "w2")]:
        calls = plan(S, pol, la)
        row = " | ".join(f"{p}x: first {fa:4.1f}s stalls {st} worst {w:4.1f}s" for p in (1.0, 1.6, 4.0) for fa, st, w in [simulate(S, calls, p)])
        print(f"{name:<38} calls {[len(g) for g, _ in calls]}  {row}")
    for la in ("full", "w2"):
        res = [adaptive(S, p, la) for p in (1.0, 1.6, 4.0)]
        print(f"{'d adaptive + ' + la + ' look-ahead':<38} calls {res[1][3]}@1.6x  " + " | ".join(f"{p}x: first {r[0]:4.1f}s stalls {r[1]} worst {r[2]:4.1f}s" for p, r in zip((1.0, 1.6, 4.0), res)))
