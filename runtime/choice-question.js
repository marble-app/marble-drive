const MULTI_HINT = /select all|one or more|multiple/i;

const TOOL_ALIASES = new Map([
  ['shell', 'Shell'],
  ['bash', 'Shell'],
  ['read_document', 'Read'],
  ['read', 'Read'],
  ['apply_ops', 'Edit'],
  ['edit', 'Edit'],
  ['updatetodos', 'Todos'],
  ['todowrite', 'Todos'],
  ['task', 'Task'],
]);

function matchOption(line) {
  let match = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/);
  if (match) return { kind: 'checkbox', label: match[1] };

  match = line.match(/^\s*[-*]\s+([A-Za-z])[.)\:]\s+(.+?)\s*$/);
  if (match) return { kind: 'keyed', key: match[1].toUpperCase(), label: match[2] };

  match = line.match(/^\s*([A-Za-z])[.)\:]\s+(.+?)\s*$/);
  if (match) return { kind: 'keyed', key: match[1].toUpperCase(), label: match[2] };

  match = line.match(/^\s*(\d+)[.)\:]\s+(.+?)\s*$/);
  if (match) return { kind: 'keyed', key: match[1], label: match[2] };

  return null;
}

export function parseChoiceQuestion(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/```[\s\S]*?```/g, '');
  const lines = normalized.split('\n');

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const collected = [];
  let index = lines.length - 1;
  while (index >= 0) {
    const line = lines[index];
    if (line.trim() === '') {
      index -= 1;
      continue;
    }
    const option = matchOption(line);
    if (!option) break;
    collected.push(option);
    index -= 1;
  }

  if (collected.length < 2) return null;

  const options = collected.reverse();
  let checkboxIndex = 0;
  let hasCheckbox = false;
  const parsedOptions = options.map((option) => {
    if (option.kind === 'checkbox') {
      hasCheckbox = true;
      checkboxIndex += 1;
      return { key: String(checkboxIndex), label: option.label };
    }
    return { key: option.key, label: option.label };
  });

  const context = [];
  while (index >= 0 && context.length < 3) {
    const line = lines[index].trim();
    if (line !== '') context.unshift(line);
    index -= 1;
  }

  const questions = context.filter((line) => line.includes('?'));
  if (questions.length === 0) return null;

  const question = questions[questions.length - 1];
  const multiHint = hasCheckbox || MULTI_HINT.test(question);

  return { question, options: parsedOptions, multiHint };
}

export function toolShortName(name) {
  if (!name) return 'Tool';

  const alias = TOOL_ALIASES.get(name.toLowerCase());
  if (alias) return alias;

  const segment = name.split(/[/:]/).pop() || '';
  if (!segment) return 'Tool';

  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
