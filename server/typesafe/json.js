// The model is asked for JSON. It often wraps it in a fence or a sentence.
// One function peels that off so shape and split do not each invent a parser.

export function parseJsonBlock(text) {
  const raw = String(text ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const slice = (fenced ? fenced[1] : raw).trim();
  const starts = ['[', '{'].map((mark) => slice.indexOf(mark)).filter((at) => at >= 0);
  if (!starts.length) {
    const err = new Error('the model did not return JSON');
    err.status = 502;
    throw err;
  }
  return JSON.parse(slice.slice(Math.min(...starts)));
}

export function asQuestionList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && value.type && value.text) return [value];
  const err = new Error('expected a JSON array of subquestions');
  err.status = 502;
  throw err;
}
