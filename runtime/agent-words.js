// What a chat's progress card says, kept in one place: the sentence for each
// step while a turn runs, the line while it waits on you, and the line it ends
// on. The card (agent-ui.js) draws its title from these, and the host
// (server/agent/runner.js) reads the same words into the chat's `activity`,
// the one line the Agents list, Focus, the Deck, the shell's pips and
// list_agents show. So a chat's row says what its card says: "Testing that it
// works" while it runs, its question while it waits on you, "Updated Agents"
// when it is done (Notes and Sketches/Build Mode and Asking/Chat Progress
// Modes, "Every chat at a glance").
//
// Loaded in the browser before agent-ui.js, and imported in node by the
// runner and the tests; it touches neither window nor document.

(() => {
  const tail = (p) => String(p ?? '').replace(/\/+$/, '').split('/').pop() || String(p ?? '');
  const trimTo = (s, n = 60) => {
    const one = String(s ?? '').replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n - 1)}…` : one;
  };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url ?? ''); } };
  const firstSentence = (text) => String(text ?? '').split(/(?<=[.!?—])\s/)[0].replace(/\s*—\s*$/, '');
  const docName = (path) => tail(path).replace(/\.mrbl$/, '') || 'this document';

  // A shell command says what it is for in its description; the words there
  // are the only honest hint whether it looked, made, or tested.
  const CHECK_WORDS = /\b(test|tests|testing|spec|verify|verifies|check|checks|lint|screenshot|render|renders|playwright|smoke|assert)\b/i;
  const BUILD_WORDS = /\b(install|build|compile|bundle|mkdir|create|creates|write|writes|generate|commit|deploy|push|patch|apply|migrate|copy|move|rename|replace|update|updates|add|adds)\b/i;

  /** A call in words anyone can read: the stage it belongs to (null keeps
   *  the stage the turn is in), a sentence, and the document it makes. */
  function plainStep(name, input = {}, built = false) {
    const doc = input.path ? docName(input.path) : '';
    const step = (stage, say, extra = {}) => ({ stage, say, ...extra });
    switch (name) {
      case 'read_document':
      case 'read_affordances':
        return step('look', doc ? `Reading ${doc}` : 'Reading the document');
      case 'list_documents': return step('look', 'Looking through your drive');
      case 'read_guide': return step('look', 'Reading up on how this works');
      case 'create_document': return step('build', `Creating ${doc || 'a new document'}`, { makes: input.path });
      case 'apply_ops': {
        // The note is written for whoever is watching ("Stage 2 of 4: the
        // cards"), so it is the best sub-line there is.
        const note = String(input.note ?? '').trim();
        return step('build', doc ? `Updating ${doc}` : 'Updating the document', { makes: input.path, note });
      }
      case 'fan_out': {
        const note = String(input.note ?? '').trim();
        return step('build', doc ? `Updating ${doc}` : 'Updating the document', { makes: input.path, note });
      }
      case 'act': return step(built ? 'check' : 'build', doc ? `Using ${doc}` : 'Using the app', { makes: input.path });
      case 'check_document': return step('check', doc ? `Double-checking ${doc}` : 'Double-checking the document');
      case 'browser_navigate':
      case 'browser_tabs':
        return step(built ? 'check' : 'look', built ? 'Opening the page to see the result' : 'Opening the page');
      case 'browser_snapshot':
      case 'browser_take_screenshot':
        return step(built ? 'check' : 'look', built ? 'Looking at how it turned out' : 'Looking at the page');
      case 'browser_click':
      case 'browser_type':
        return step(built ? 'check' : 'look', built ? 'Trying it out' : 'Clicking around the page');
      case 'browser_close':
      case 'browser_navigate_back':
        return step(null, 'Looking at the page');
      case 'WebSearch':
      case 'web_search': {
        const q = trimTo(input.search_term || input.query || '', 48);
        return step('look', q ? `Searching the web for “${q}”` : 'Searching the web');
      }
      case 'WebFetch': return step('look', `Reading ${hostOf(input.url)}`);
      case 'Read':
      case 'read':
      case 'read_file':
        return step('look', 'Reading through the files');
      case 'Grep':
      case 'grep':
      case 'Glob':
      case 'glob':
      case 'LS':
      case 'ToolSearch':
        return step('look', 'Searching for the right place');
      case 'Edit':
      case 'edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return step('build', 'Writing the changes', { file: input.file_path ?? input.notebook_path ?? input.path });
      case 'Write':
      case 'write':
        return step('build', 'Writing a new piece', { file: input.file_path ?? input.path });
      case 'Bash':
      case 'Shell':
      case 'shell': {
        const said = String(input.description || input.command || input.cmd || input.preview || '');
        if (CHECK_WORDS.test(said)) return step('check', 'Testing that it works');
        if (BUILD_WORDS.test(said)) return step('build', 'Putting the pieces in place');
        return step('look', 'Looking around behind the scenes');
      }
      case 'Task':
      case 'task':
      case 'Agent': return step(null, 'Handing part of the work to a helper');
      case 'TodoWrite':
      case 'updateTodos':
        return step(null, 'Making a plan');
      case 'Skill': return step('look', input.skill ? `Following the ${input.skill} playbook` : 'Following a playbook');
      case 'send_message':
      case 'SendMessage':
      case 'wait_for_reply':
      case 'list_agents':
      case 'ListAgents':
        return step(null, 'Checking in with another agent');
      case 'Monitor': return step(null, 'Waiting for something to finish');
      case 'list_events':
      case 'search_events':
      case 'get_event':
        return step('look', 'Checking your calendar');
      case 'search_threads':
      case 'get_thread':
      case 'get_message':
        return step('look', 'Checking your email');
      default: return step(null, 'Working on it');
    }
  }

  /** What the card says while a turn waits on you: a permission is "Needs
   *  your OK", a question is the question itself. */
  function askSay(event = {}) {
    if (event.kind === 'question' || event.tool === 'AskUserQuestion') {
      const q = (event.input?.questions ?? []).map((x) => x?.question).find((x) => typeof x === 'string' && x.trim());
      return q ? trimTo(q, 160) : 'Needs your answer';
    }
    return 'Needs your OK';
  }

  /** What the card says once a permission is answered and the turn goes on. */
  function askClosedSay(event = {}) {
    if (event.type === 'ask.void') return 'Going on without an answer';
    return event.response?.behavior === 'allow' ? 'Going ahead' : 'Stopping there';
  }

  /** The card's title when a turn ends. `names` are the documents it made
   *  or changed; `built` is whether it made anything at all. */
  function endSay(state, { names = [], built = false } = {}) {
    const listed = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
    return {
      completed: names.length ? `Updated ${listed}` : built ? 'Made the changes' : 'All done',
      declined: 'Stopped at your call',
      failed: 'Something went wrong',
      cancelled: 'Stopped',
      interrupted: 'Interrupted',
    }[state] ?? 'Done';
  }

  /** Why a step failed, in its first sentence, kept so a failed turn can say
   *  where it got stuck. */
  const stuckWhy = (event = {}) => firstSentence(event.summary) || (event.denied ? 'That was turned down.' : 'That step failed.');

  /** The line a failed turn's card ends on: where it got stuck, else the
   *  first sentence of the error. */
  const failedLine = ({ stuck = null, error = '' } = {}) => stuck?.why || firstSentence(error) || 'It could not finish.';

  // ------------------------------------------------------------- one chat's line
  //
  // The card's sentence, followed through a turn's events the way the card
  // follows them, for whoever only has the events (the host). `say` is ''
  // until the turn has done something a card would show.

  function createLine() {
    return { say: '', card: false, stage: null, built: false, docs: new Map(), stuck: null, asks: new Map() };
  }

  const made = (line, path) => {
    if (!path) return;
    const key = String(path).replace(/\.mrbl$/, '');
    if (!line.docs.has(key)) line.docs.set(key, docName(key));
    line.built = true;
    line.card = true;
  };

  /** What the line says now: an open ask's words, else the step's sentence. */
  function lineNow(line) {
    const asks = [...line.asks.values()];
    return asks.length ? asks[asks.length - 1].say : line.say;
  }

  /** Take one of a turn's events; answers what the line says after it. */
  function noteLine(line, event = {}) {
    switch (event.type) {
      case 'tool.call': {
        const step = plainStep(event.name, event.input ?? {}, line.built);
        if (step.makes) made(line, step.makes);
        const stage = step.stage ?? line.stage ?? 'look';
        if (stage === 'build') line.built = true;
        line.stage = stage;
        line.say = step.say;
        line.card = true;
        break;
      }
      case 'tool.result':
        if (event.ok === false) line.stuck = { why: stuckWhy(event), denied: Boolean(event.denied) };
        break;
      case 'ops.applied':
      case 'document.changed':
        made(line, event.path);
        break;
      case 'ask':
        line.asks.set(event.requestId, { kind: event.kind, say: askSay(event) });
        // A permission is asked inside the card; a question has a card of its own.
        if (event.kind !== 'question') line.card = true;
        break;
      case 'ask.answered':
      case 'ask.void': {
        const ask = line.asks.get(event.requestId);
        if (!ask) break;
        line.asks.delete(event.requestId);
        // A permission is answered in the card's own line; a question is
        // answered in its own card, and the line goes back to the work.
        if (ask.kind !== 'question') {
          line.say = askClosedSay(event);
          line.card = true;
        }
        break;
      }
      default:
    }
    return lineNow(line);
  }

  /** The line a turn ends on, as its card ends: '' when the turn showed
   *  nothing a card would, so the caller keeps what it said before. */
  function endLine(line, status, { error = '' } = {}) {
    if (!line.card) return '';
    const declined = status === 'failed' && line.stuck?.denied;
    if (status === 'failed' && !declined) return failedLine({ stuck: line.stuck, error });
    return endSay(declined ? 'declined' : status, { names: [...line.docs.values()], built: line.built });
  }

  globalThis.marbleAgentWords = {
    CHECK_WORDS,
    BUILD_WORDS,
    docName,
    firstSentence,
    plainStep,
    askSay,
    askClosedSay,
    endSay,
    stuckWhy,
    failedLine,
    createLine,
    noteLine,
    lineNow,
    endLine,
  };
})();
