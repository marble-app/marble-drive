import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const doc = new URL('../drive/Research/Elicitive UI/Elicitive UI Dataset Strategy.mrbl', import.meta.url);
const read = () => readFile(doc, 'utf8');

// The runtime is 800 lines of JavaScript that mentions nearly every affordance
// in its own comments and CSS. Assertions about what the *document* offers have
// to look at the markup, or a comment will answer for a missing control.
const markupOnly = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '');

test('the notes are a self-contained Marble document', async () => {
  const html = await read();
  assert.match(html, /<title>Elicitive UI/);
  assert.match(html, /data-marble="1"/);
  assert.match(html, /marble:capabilities/);
  // Nothing in the file may name a host, a route, or a server.
  assert.doesNotMatch(html, /\/intent\b|localhost|127\.0\.0\.1/);
});

test('every addressed element carries its own id, and no id appears twice', async () => {
  const html = await read();
  const ids = [...html.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 400, `expected a fully addressed document, got ${ids.length} ids`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate data-marble-id');
});

test('the eight sections and the capture inbox are all present', async () => {
  const html = await read();
  for (const section of ['keeping', 'thesis', 'method', 'evidence', 'landscape', 'datasets', 'models', 'plan', 'sources']) {
    assert.match(html, new RegExp(`id="${section}"`), `missing section ${section}`);
  }
  assert.match(html, /class="rail"/, 'has an index rail');
});

test('it is a notetaking space: things can be added, ranked, marked and dropped', async () => {
  const markup = markupOnly(await read());

  // Capture first — the gesture the document previously had no home for.
  assert.match(markup, /data-marble-add="#tpl-keep" data-marble-into="#keeps"/);
  assert.match(markup, /data-marble-choose="data-state" data-marble-of="\.keep"/);

  // Every list and every table body accepts a new row and reorders.
  for (const group of [
    'keeps', 'paper', 'studies', 'models', 'phases', 'questions', 'sources',
    'rows-pipe', 'rows-val', 'rows-land', 'rows-data', 'rows-base',
  ]) {
    assert.match(markup, new RegExp(`data-marble-sortable="${group}"`), `nothing sortable in ${group}`);
  }

  assert.ok(
    [...markup.matchAll(/data-marble-removable/g)].length > 60,
    'expected most rows to be removable',
  );

  // Triage marks: questions answer yes/no, phases open and close.
  assert.match(markup, /data-marble-toggle="data-done:yes\|no" data-marble-of="li"/);
  assert.match(markup, /data-marble-toggle="data-open:1\|0" data-marble-of="\.phase"/);
});

test('every + button names a template and a container that exist', async () => {
  const html = await read();
  const markup = markupOnly(html);
  const buttons = [...markup.matchAll(/data-marble-add="#([^"]+)"[^>]*data-marble-into="#([^"]+)"/g)];
  assert.ok(buttons.length >= 14, `expected the lists to be addable, got ${buttons.length} + buttons`);
  for (const [, template, container] of buttons) {
    assert.match(html, new RegExp(`<template id="${template}">`), `no template ${template}`);
    assert.match(markup, new RegExp(`\\sid="${container}"`), `no container ${container}`);
  }
});

test('a template carries no id of its own', async () => {
  const html = await read();
  const templates = [...html.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g)];
  assert.ok(templates.length >= 11, `expected a template per list, got ${templates.length}`);
  for (const [, name, body] of templates) {
    // An id baked into a template would arrive again with every clone.
    assert.doesNotMatch(body, /data-marble-id=/, `template ${name} ships an id`);
    assert.match(body, /data-marble-editable/, `template ${name} has nothing to type into`);
  }
});

test('nothing that can be typed over holds inline markup', async () => {
  const html = await read();
  // Typing over an element files a setText, which would take the <em> with it.
  // Prose that needs emphasis is data-marble-rich instead.
  for (const [whole, , , inner] of html.matchAll(/<([a-z0-9]+)([^>]*data-marble-editable[^>]*)>([\s\S]*?)<\/\1>/g)) {
    assert.doesNotMatch(inner, /<(b|i|em|strong|span|a|code)\b/, `editable holds markup: ${whole.slice(0, 80)}`);
  }
  assert.ok(
    [...html.matchAll(/data-marble-rich/g)].length >= 9,
    'the paragraphs with emphasis should be marked rich',
  );
});

test('the method is not hidden behind tabs any more', async () => {
  const markup = markupOnly(await read());
  assert.doesNotMatch(markup, /class="tabs"|data-method-go|class="pane/, 'the tab strip is gone');
  for (const fold of ['pane-pipeline', 'pane-paper', 'pane-validity', 'pane-eui']) {
    assert.match(markup, new RegExp(`id="${fold}"[^>]*data-expanded="yes"`), `${fold} should open by default`);
  }
  assert.equal([...markup.matchAll(/data-marble-expand/g)].length, 4, 'four folds, four disclosures');
});

test('the axis descriptions live in the file, not in a script', async () => {
  const html = await read();
  const markup = markupOnly(html);
  assert.match(markup, /data-marble-choose="data-axis" data-marble-of="body"/);
  for (const axis of ['fidelity', 'saliency', 'amount', 'frequency', 'assertiveness', 'placement']) {
    assert.match(markup, new RegExp(`class="axisdesc" data-axis="${axis}"`), `no panel for ${axis}`);
    assert.match(html, new RegExp(`body\\[data-axis="${axis}"\\]`), `no CSS pairing for ${axis}`);
  }
  // The old script rebuilt these paragraphs from a table while they were also
  // editable, so a note typed into one was overwritten on the next reconcile.
  // The prose itself is the thing that must not be in a script.
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(scripts, /How settled the UI appears/, 'axis prose is back in a script');
  assert.doesNotMatch(scripts, /axisCopy\s*=/, 'the duplicated copy table is back');
});

test('a note can be attached to what should not be rewritten', async () => {
  const markup = markupOnly(await read());
  const notes = [...markup.matchAll(/data-marble-note(?![-a-z])/g)].length;
  assert.ok(notes >= 15, `expected the claims and diagrams to be annotatable, got ${notes}`);
  // A grip is a <div>, so it cannot be prepended into an <svg> or a <p>.
  for (const [whole] of markup.matchAll(/<(svg|p)\b[^>]*data-marble-note(?![-a-z])[^>]*>/g)) {
    assert.fail(`note on an element that cannot hold a grip: ${whole.slice(0, 70)}`);
  }
});

test('every gesture is survivable: undo is bound, drawn, and reachable', async () => {
  const html = await read();
  assert.match(html, /marble\.record\(/, 'gestures record an inverse');
  assert.match(html, /marble\.canUndo/, 'undo state is a fact the document reads');
  assert.match(html, /marble-can-undo/, 'and one it draws');
  assert.match(html, /key\.toLowerCase\(\) === 'z'|=== 'z'/, 'Mod+Z is bound');
  assert.match(html, /marble-reversal/, 'a removal offers itself back');
  assert.match(html, /marble-status/, 'the write is reported');
  assert.match(html, /data-state="error"/, 'including when it fails');
  assert.match(html, /data-marble-readonly/, 'no host is a visible state');
});

test('no second source of truth', async () => {
  const html = await read();
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.doesNotMatch(html, /\.outerHTML\s*=/);
  // Which figure is open, and whether a host is present, belong to the tab.
  assert.match(html, /pageOnly\('data-lb', 'data-marble-readonly'\)/);
});
