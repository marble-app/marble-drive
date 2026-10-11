# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "demucs==4.0.1",
#   "torch==2.5.1",
#   "torchaudio==2.5.1",
#   "soundfile>=0.12.1",
#   "numpy<2.3",
# ]
# ///
"""Split one song into its voice and its band, for the host's stem splitter.

Run by server/stems/index.js as `uv run --script split.py IN OUT_DIR`, so the
environment is uv's to build and cache and the host never needs a Python of its
own. Speaks JSON lines on stdout — `{"stage": …}`, `{"progress": 0..1}`, and a
last `{"done": …}` naming the files it wrote — and says nothing else there, so
the host can read every line it gets.

HT-Demucs (Rouard, Massa and Défossez, ICASSP 2023; MIT licence). The default is
`htdemucs_ft`, the four fine-tuned models averaged: about four times the work of
`htdemucs` and the cleanest voice it has. On Apple silicon it runs on the GPU
through Metal (MPS); anywhere else, CUDA if there is one, then the CPU.
"""

import argparse
import json
import os
import sys
import time

# Weights are fetched on first use into torch's hub cache; keep it out of the
# drive and out of the repo.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")


def teach_metal_long_convolutions(torch):
    """Metal refuses a 1-D convolution whose output is longer than 65 536
    samples, and HT-Demucs's time branch reads 7.8 s at 44.1 kHz — 343 980 of
    them. Cut such a convolution into pieces along time and put them back
    together. The answer is the same to the sample (a piece reads exactly the
    input its outputs depend on), and it only happens on MPS: every other
    device goes straight through."""
    F = torch.nn.functional
    conv1d, conv_tr = F.conv1d, F.conv_transpose1d
    one = lambda v: v[0] if isinstance(v, (tuple, list)) else v
    LIMIT = 32768

    def long_conv1d(x, w, bias=None, stride=1, padding=0, dilation=1, groups=1):
        s, p, d, k = one(stride), one(padding), one(dilation), w.shape[-1]
        if x.device.type != "mps" or isinstance(p, str):
            return conv1d(x, w, bias, stride, padding, dilation, groups)
        n = x.shape[-1] + 2 * p
        out_len = (n - d * (k - 1) - 1) // s + 1
        if out_len <= LIMIT and n <= 2 * LIMIT:
            return conv1d(x, w, bias, stride, padding, dilation, groups)
        if p:
            x = F.pad(x, (p, p))
        step = max(1, LIMIT // s)
        pieces = []
        for a in range(0, out_len, step):
            b = min(out_len, a + step)
            pieces.append(conv1d(x[..., a * s:(b - 1) * s + d * (k - 1) + 1], w, bias, s, 0, d, groups))
        return torch.cat(pieces, -1)

    def long_conv_tr(x, w, bias=None, stride=1, padding=0, output_padding=0, groups=1, dilation=1):
        s, p, op, d, k = one(stride), one(padding), one(output_padding), one(dilation), w.shape[-1]
        n = x.shape[-1]
        full = (n - 1) * s + d * (k - 1) + 1
        if x.device.type != "mps" or (full <= LIMIT and n <= LIMIT):
            return conv_tr(x, w, bias, stride, padding, output_padding, groups, dilation)
        out = None
        step = max(1, LIMIT // s)
        for a in range(0, n, step):
            piece = conv_tr(x[..., a:a + step], w, None, s, 0, 0, groups, d)
            if out is None:
                out = piece.new_zeros(*piece.shape[:-1], full + op)
            out[..., a * s:a * s + piece.shape[-1]] += piece
        if bias is not None:
            out = out + bias[:, None]
        return out[..., p:full + op - p]

    F.conv1d, F.conv_transpose1d = long_conv1d, long_conv_tr


def say(**msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out_dir")
    ap.add_argument("--model", default="htdemucs_ft")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--format", default="flac", choices=["flac", "wav"])
    args = ap.parse_args()

    say(stage="starting")
    import numpy as np
    import soundfile as sf
    import torch
    import julius
    import demucs.apply as dapply
    from demucs.pretrained import get_model

    teach_metal_long_convolutions(torch)

    device = args.device
    if device == "auto":
        device = (
            "mps" if torch.backends.mps.is_available()
            else "cuda" if torch.cuda.is_available()
            else "cpu"
        )

    say(stage="reading")
    try:
        data, sr = sf.read(args.input, dtype="float32", always_2d=True)
    except Exception as err:  # noqa: BLE001 — anything libsndfile cannot open
        say(error=f"could not read the song: {err}")
        return 2
    wav = torch.from_numpy(data.T.copy())
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    wav = wav[:2]

    say(stage="model", model=args.model, device=device)
    model = get_model(args.model)
    model.eval()
    if sr != model.samplerate:
        wav = julius.resample_frac(wav, sr, model.samplerate)
    seconds = wav.shape[-1] / model.samplerate

    # demucs reports through tqdm, one bar per model in the bag. Counting the
    # bars and the steps through each turns that into one fraction.
    parts = len(getattr(model, "models", [model]))
    seen = {"bars": 0, "last": 0.0}

    class Counting:
        def __init__(self, iterable, **_):
            self.iterable = iterable
            self.total = len(iterable)
            self.bar = seen["bars"]
            seen["bars"] += 1

        def __iter__(self):
            for i, item in enumerate(self.iterable):
                yield item
                done = min(1.0, (self.bar + (i + 1) / max(1, self.total)) / parts)
                now = time.monotonic()
                if done >= 1.0 or now - seen["last"] > 0.4:
                    seen["last"] = now
                    say(progress=round(done, 4))

    class FakeTqdm:
        tqdm = Counting

    dapply.tqdm = FakeTqdm

    # Loudness-normalise the way demucs's own CLI does, and undo it after.
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = (wav - mean) / std

    say(stage="splitting", seconds=round(seconds, 2), device=device)
    t0 = time.monotonic()

    def run(on):
        with torch.no_grad():
            return dapply.apply_model(
                model, x[None], device=on, shifts=1, split=True, overlap=0.25, progress=True,
            )[0]

    try:
        sources = run(device)
    except Exception as err:  # noqa: BLE001 — an op Metal lacks, a GPU out of memory
        if device == "cpu":
            raise
        say(stage="fallback", device="cpu", reason=str(err)[:300])
        seen["bars"] = 0
        device = "cpu"
        sources = run("cpu")
    sources = sources * std + mean

    names = list(model.sources)
    vi = names.index("vocals")
    vocals = sources[vi]
    band = sources.sum(0) - vocals

    os.makedirs(args.out_dir, exist_ok=True)
    ext = args.format
    written = {}
    for key, stem in (("vocals", vocals), ("instrumental", band)):
        a = stem.cpu().numpy().T
        peak = float(np.abs(a).max()) if a.size else 0.0
        # A stem can overshoot full scale where the mix was limited; bring it
        # back down rather than clip it.
        if peak > 0.999:
            a = a * (0.999 / peak)
        path = os.path.join(args.out_dir, f"{key}.{ext}")
        sf.write(path, a, model.samplerate, subtype="PCM_16")
        written[key] = path

    say(
        done=True,
        files=written,
        samplerate=model.samplerate,
        seconds=round(seconds, 2),
        took=round(time.monotonic() - t0, 2),
        device=device,
        model=args.model,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
