// A turn is the first thing the kernel takes when the machine runs out of
// memory, and the host the last.
//
// On a Fly Sprite every service starts as the kernel's near-last choice
// (oom_score_adj -900), and a turn, as the host's child, would inherit that:
// a browser test that ate the machine was then no likelier to go than the host
// it ran under. A turn's command starts through a shell that raises its own
// score and execs the command, so the turn and everything it runs (Claude, its
// tools, a test's Chromium) go first. Raising one's own score needs no
// privilege. Where there is no such file (a Mac), the launch is unchanged.

import fs from 'node:fs';

const SCORE = 500;
const CAN = fs.existsSync('/proc/self/oom_score_adj');
const RAISE = `echo ${SCORE} > /proc/$$/oom_score_adj 2>/dev/null; exec "$@"`;

export function firstToGo(launch, can = CAN) {
  if (!can) return launch;
  return { ...launch, command: 'sh', args: ['-c', RAISE, 'marble-agent', launch.command, ...launch.args] };
}
