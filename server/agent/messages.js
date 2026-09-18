// Messages between two agent conversations: the limits, and the pure
// functions the runner and the tools share. Nothing here reads a file or
// knows what a turn is; that is what keeps it testable in a line each.

export const MAX_TEXT = 4000;
export const MAX_SENDS = 12;
export const MAX_HOP = 8;
export const WAIT_DEFAULT = 120;
export const WAIT_MIN = 5;
export const WAIT_MAX = 300;

/** Null when the text is fine, else the reason it is not. */
export function validateText(text) {
  if (typeof text !== 'string') return 'text must be a string';
  if (!text.trim()) return 'text is empty';
  if (text.length > MAX_TEXT) return `text is over ${MAX_TEXT} characters`;
  return null;
}

/** How long one wait_for_reply may block. Clamped so the MCP client's own
 *  tool timeout never fires first; the agent is told a timeout means
 *  "nothing yet". */
export function clampSeconds(value) {
  if (value === null || value === undefined) return WAIT_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return WAIT_DEFAULT;
  return Math.min(WAIT_MAX, Math.max(WAIT_MIN, Math.floor(n)));
}

/** A turn cannot exist without a document. The receiver's own is the natural
 *  one; failing that, the document the message is about; failing that, the
 *  sender's. */
export function pickTarget({ receiver, about, senderTarget }) {
  return receiver?.target || about?.path || senderTarget || null;
}

/** The prompt a batch of messages becomes. `titles` maps a conversation id
 *  to `{ title, provider }` for the senders the caller could look up. */
export function renderMessages(messages, titles = new Map()) {
  const blocks = messages.map((m) => {
    const who = titles.get(m.from);
    const lines = [
      `Message from the conversation "${who?.title || m.from}" (${m.from}, ${who?.provider || 'unknown'}):`,
      '',
      m.text,
      '',
    ];
    if (m.about?.path) {
      const ids = Array.isArray(m.about.ids) && m.about.ids.length ? ` — ${m.about.ids.join(', ')}` : '';
      lines.push(`[About: ${m.about.path}${ids}]`);
    }
    lines.push(`Reply with send_message to "${m.from}" and inReplyTo "${m.id}".`);
    return lines.join('\n');
  });
  return blocks.join('\n\n---\n\n');
}
