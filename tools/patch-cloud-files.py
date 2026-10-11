#!/usr/bin/env python3
"""Carry the Drive template's cloud-file changes into a live Drive document.

The owner's live drive.mrbl is far ahead of templates/drive.mrbl, so it gets
the same edits by anchor rather than by copy: the page drawing a picture when
the host has none (marble.drive.drawThumb), and the upload tray's reconnecting
label, Retry button and "drop it again" hint for resumable uploads. The
drive's own realms and folders are not touched.

    python3 tools/patch-cloud-files.py <in.mrbl> <out.mrbl>

Idempotent: an edit already present is skipped. If any anchor is missing,
nothing is written and the exit code is 1. Write the live document only with
the host stopped: a running serve reverts markup written under it.
"""

import sys

EDITS = [
    (
        "picture drawn by the page when the host has none",
        """        img.addEventListener('error', () => {
          // No thumbnailer here, or none for this kind: a picture the browser
          // can draw is drawn from the file itself, and anything else keeps
          // its glyph.
          if (fellBack || !NATIVE_IMAGE.has(el.dataset.ext)) return;
          fellBack = true;
          img.src = drive.fileHref(path);
        });""",
        """        let drew = false;
        img.addEventListener('error', () => {
          // No picture on the host yet: the page draws one and hands it over
          // (marble.drive.drawThumb), so the next visit has it.
          if (!drew && drive.drawThumb) {
            drew = true;
            drive.drawThumb({ path, ext: el.dataset.ext }).then((src) => {
              if (src) img.src = src;
              else if (NATIVE_IMAGE.has(el.dataset.ext)) img.src = drive.fileHref(path);
            });
            return;
          }
          // Nothing drawn either: a picture the browser can show is shown
          // from the file itself, and anything else keeps its glyph.
          if (fellBack || !NATIVE_IMAGE.has(el.dataset.ext)) return;
          fellBack = true;
          img.src = drive.fileHref(path);
        });""",
    ),
    (
        "Retry sends paused files again",
        """      tray.querySelector('.up-foot button').addEventListener('click', () => {
        if (uploading) uploading.abort();
        else tray.removeAttribute('data-open');
      });""",
        """      tray.querySelector('.up-foot button').addEventListener('click', () => {
        if (uploading) return uploading.abort();
        // Files whose connection dropped are still held by the page: Retry
        // sends them again, and the host's session means they carry on.
        const again = tray.retry;
        tray.retry = null;
        if (again?.length) return receive([], [], again.into, again);
        tray.removeAttribute('data-open');
      });""",
    ),
    (
        "receive takes a prepared list",
        """      async function receive(entries, files, into) {
        let dropped = files.map((file) => ({ file, folder: '' }));""",
        """      async function receive(entries, files, into, prepared = null) {
        let dropped = prepared ? [...prepared] : files.map((file) => ({ file, folder: '' }));""",
    ),
    (
        "a list of files to retry",
        """        const added = [];
        const refused = [];
        let cancelled = false;""",
        """        const added = [];
        const refused = [];
        const retry = [];
        let cancelled = false;""",
    ),
    (
        "the row says reconnecting",
        """                    onProgress: (loaded) => {
                      sent[i] = Math.min(loaded, file.size);
                      mark(i, 'going', Math.floor((sent[i] / (file.size || 1)) * 100) + '%');
                      paint();
                    },
                  }),""",
        """                    onProgress: (loaded) => {
                      sent[i] = Math.min(loaded, file.size);
                      mark(i, 'going', Math.floor((sent[i] / (file.size || 1)) * 100) + '%');
                      paint();
                    },
                    // A chunk the network dropped is being retried.
                    onState: (state) => {
                      if (state === 'reconnecting') mark(i, 'going', 'reconnecting…');
                    },
                  }),""",
    ),
    (
        "a paused file is kept for Retry",
        """            } else {
              refused.push(file.name + ' — ' + (err?.message ?? err));
              mark(i, 'failed', err?.message ?? 'refused');
            }""",
        """            } else {
              refused.push(file.name + ' — ' + (err?.message ?? err));
              mark(i, 'failed', err?.retryable ? 'paused' : err?.message ?? 'refused');
              if (err?.retryable) retry.push({ file, folder });
            }""",
    ),
    (
        "the tray offers Retry",
        """        tray.setAttribute('data-state', refused.length || cancelled ? 'failed' : 'done');
        button.textContent = 'Close';""",
        """        tray.setAttribute('data-state', refused.length || cancelled ? 'failed' : 'done');
        tray.retry = retry.length ? Object.assign(retry, { into }) : null;
        button.textContent = retry.length ? 'Retry' : 'Close';""",
    ),
    (
        "an unfinished upload is announced",
        """      drawNav();
      positionThumb();
      refresh();
    };""",
        """      drawNav();
      positionThumb();
      refresh();
      // An upload this browser started and did not finish is waiting on the
      // host; the file itself went with the last page, so it has to be
      // dropped again to carry on.
      const pending = drive.pendingUploads?.() ?? [];
      if (pending.length) {
        say('Drop “' + pending[0].name + '” again to finish adding it' + (pending.length > 1 ? ' (and ' + (pending.length - 1) + ' more)' : ''));
      }
    };""",
    ),
]


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        text = f.read()
    missing = []
    for name, old, new in EDITS:
        if new in text:
            print(f"already: {name}")
            continue
        if text.count(old) != 1:
            missing.append(f"{name} (anchor found {text.count(old)} times)")
            continue
        text = text.replace(old, new)
        print(f"applied: {name}")
    if missing:
        print("not written — missing anchors:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1
    with open(dst, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {dst}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
