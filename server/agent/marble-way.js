// The Marble way: the second brief on every ask that builds.
//
// Make it interactive, Try variations, Automate it and Sketch it ask an agent
// to build something in the page, and so does "turn this into a checklist"
// typed anywhere. An agent left to itself tends to build a picture of the
// thing: a list redrawn from a script variable, labels drawn in an SVG, a
// checkbox that forgets itself on reload. It looks right until the person
// tries to change it.
//
// So a turn whose ask is about building carries this text after its context,
// in the prompt the agent reads, never in the message the chat shows. The
// test is words, not a model: cheap, and wrong only in the harmless direction
// (a question that mentions a button gets a paragraph it did not need).
//
// Design: Notes and Sketches/Ask at Anything, v3, "What it builds stays yours
// to edit".

const BUILD_WORDS = [
  'interactive', 'interactivity', 'clickable', 'click to', 'tap to', 'drag', 'draggable', 'drop',
  'reorder', 'sortable', 'toggle', 'checkbox', 'checklist', 'check off', 'slider', 'button', 'widget',
  'an app', 'mini app', 'tracker', 'board', 'kanban', 'chart', 'graph', 'plot', 'diagram', 'visual',
  'visualise', 'visualize', 'visualisation', 'visualization', 'timeline', 'calculator', 'form',
  'dashboard', 'canvas', 'prototype', 'demo', 'game', 'simulation', 'animate', 'animation', 'tabs',
  'accordion', 'carousel', 'editor', 'filter', 'variations', 'versions', 'automate', 'automatic',
  'marble-alt', 'data-marble-run', 'sketch',
];
const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
const BUILDS = new RegExp(`(?:^|[^\\w-])(?:${BUILD_WORDS.map(escape).join('|')})(?:s|es|ed|ing)?(?=$|[^\\w-])`, 'i');

/** Whether an ask is about building something in the page. */
export const buildsSomething = (...texts) => texts.some((text) => BUILDS.test(String(text ?? '')));

const COMMON = [
  '- The file is the state. Anything a person can change in what you build (words they type, a box they check, a choice, an order, a row they add) changes the page and is filed with window.marble.op, so it is still there after a reload. Nothing that should last lives only in a script variable, localStorage or a shadow root.',
  '- Words stay words. Text that was editable stays editable (data-marble-editable), and text you add is editable too. Never redraw it from script, or put it in an image, a canvas or an SVG label.',
  '- Keep every data-marble-id you were given. Change elements in place; never remove one to insert its replacement.',
];

/** The brief, for an agent with these tools. A documents agent has no skills
 *  and no shell, so it is pointed at the guide; a full agent at the skill. */
export function marbleWay(capability = 'full') {
  if (capability === 'full') {
    return [
      'Build it the Marble way. Before you write markup or script, read how Marble builds (the marble:build-in-marble skill, or read_guide "Persistence") and follow it:',
      ...COMMON,
      '- A marker (data-marble-editable, -toggle, -sortable, -choose, -add, -removable) only works if the document\'s script wires it. Use the ones it wires, and get the script for a new kind from affordance_script.',
      '- Run check_document when you are done, and fix what it finds.',
    ].join('\n');
  }
  return [
    'Build it the Marble way. Before you write markup or script, read read_guide "Persistence" and "Affordances" and follow them:',
    ...COMMON,
    '- A marker (data-marble-editable, -toggle, -sortable, -choose, -add, -removable) only works if the document\'s script wires it. Use the ones it already wires.',
  ].join('\n');
}

/** How long a brief a page may hand the host to ride along with one turn. */
export const BRIEF_MAX = 4_000;
