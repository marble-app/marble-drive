// What each share level may change, and what none of them may.
import assert from 'node:assert/strict';
import test from 'node:test';

import { SAYS, markupRefusal, shareRefusal } from '../server/share-policy.js';

const DOC = `<!doctype html>
<html data-marble-id="h"><head data-marble-id="hd"><title data-marble-id="t">Sign-up</title>
<style data-marble-id="css">body { margin: 0 }</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="title">Potluck</h1>
  <p data-marble-id="intro">Bring something.</p>
  <ul data-marble-id="list" data-marble-add data-marble-sortable>
    <li data-marble-id="r1"><span data-marble-id="r1n" data-marble-editable>Ana</span><button data-marble-id="r1t" data-marble-toggle="done" data-marble-of="li">Done</button></li>
    <li data-marble-id="r2"><span data-marble-id="r2n" data-marble-editable>Ben</span></li>
  </ul>
  <a data-marble-id="link" href="/a/Elsewhere">Elsewhere</a>
  <article data-marble-id="card" class="card"><h2 data-marble-id="ch">Card</h2><button data-marble-id="cb" data-marble-toggle="open" data-marble-of=".card">Open</button></article>
  <div data-marble-id="app"><p data-marble-id="inapp">kept</p><script data-marble-id="code">window.x = 1</script></div>
</body></html>`;

const refused = (ops, role) => shareRefusal(DOC, ops, role);

test('a read-only link files nothing, not even an id', () => {
  assert.equal(refused([{ type: 'setText', id: 'r1n', text: 'Ana B' }], 'view'), SAYS.read);
  assert.equal(refused([{ type: 'assignId', path: [1, 0], id: 'abc' }], 'view'), SAYS.read);
  assert.equal(refused([], 'nonsense'), SAYS.read);
});

test('read & write changes what the page offers to change', () => {
  assert.equal(refused([{ type: 'setText', id: 'r1n', text: 'Ana B' }], 'edit'), null);
  assert.equal(refused([{ type: 'insert', parentId: 'list', beforeId: null, html: '<li data-marble-id="r3"><span data-marble-id="r3n" data-marble-editable>Cy</span></li>' }], 'edit'), null);
  assert.equal(refused([{ type: 'move', id: 'r2', parentId: 'list', beforeId: 'r1' }], 'edit'), null);
  assert.equal(refused([{ type: 'remove', id: 'r2' }], 'edit'), null);
  // A toggle's target is the row it points at, which has no marker of its own.
  assert.equal(refused([{ type: 'setAttr', id: 'r1', name: 'data-done', value: '' }], 'edit'), null);
  assert.equal(refused([{ type: 'assignId', path: [1, 1], id: 'n3w' }], 'edit'), null);
  // A control that points at an ancestor outside any marked part.
  assert.equal(refused([{ type: 'setAttr', id: 'card', name: 'data-open', value: '' }], 'edit'), null);
  assert.equal(refused([{ type: 'setText', id: 'ch', text: 'Mine' }], 'edit'), SAYS.region);
});

test('read & write leaves the rest of the page alone', () => {
  assert.equal(refused([{ type: 'setText', id: 'title', text: 'Mine now' }], 'edit'), SAYS.region);
  assert.equal(refused([{ type: 'remove', id: 'intro' }], 'edit'), SAYS.region);
  assert.equal(refused([{ type: 'insert', parentId: 'b', beforeId: null, html: '<p>hi</p>' }], 'edit'), SAYS.region);
  assert.equal(refused([{ type: 'setAttr', id: 'b', name: 'style', value: 'background:red' }], 'edit'), SAYS.region);
  assert.equal(refused([{ type: 'move', id: 'r1', parentId: 'b', beforeId: null }], 'edit'), SAYS.region);
  assert.equal(refused([{ type: 'insert', parentId: 'list', beforeId: null, html: '<li><style>li{color:red}</style></li>' }], 'edit'), SAYS.style);
});

test('a row added and typed into in one batch is judged as the row it is', () => {
  const ops = [
    { type: 'insert', parentId: 'list', beforeId: null, html: '<li data-marble-id="r9"><span data-marble-id="r9n" data-marble-editable></span></li>' },
    { type: 'setText', id: 'r9n', text: 'Dee' },
  ];
  assert.equal(refused(ops, 'edit'), null);
});

test('read, write & modify changes the page itself', () => {
  assert.equal(refused([{ type: 'setText', id: 'title', text: 'Potluck, Sunday' }], 'modify'), null);
  assert.equal(refused([{ type: 'remove', id: 'intro' }], 'modify'), null);
  assert.equal(refused([{ type: 'insert', parentId: 'b', beforeId: null, html: '<section><h2>Drinks</h2><p>Bring <a href="https://example.com/x">these</a>.</p></section>' }], 'modify'), null);
  assert.equal(refused([{ type: 'setAttr', id: 'b', name: 'style', value: 'background:#fafaf7' }], 'modify'), null);
  assert.equal(refused([{ type: 'setInner', id: 'css', html: 'body { margin: 2rem }' }], 'modify'), null);
  assert.equal(refused([{ type: 'insert', parentId: 'hd', beforeId: null, html: '<style>h1{font-weight:600}</style>' }], 'modify'), null);
  assert.equal(refused([{ type: 'setAttr', id: 'link', name: 'href', value: 'mailto:a@b.c' }], 'modify'), null);
});

test('no level touches the page’s code', () => {
  for (const role of ['edit', 'modify']) {
    assert.equal(refused([{ type: 'remove', id: 'code' }], role), role === 'edit' ? SAYS.code : SAYS.code);
    assert.equal(refused([{ type: 'setInner', id: 'code', html: 'fetch("/agent/x")' }], role), SAYS.code);
    assert.equal(refused([{ type: 'setAttr', id: 'code', name: 'src', value: '/x.js' }], role), SAYS.code);
  }
  // Nor anything that holds it.
  assert.equal(refused([{ type: 'remove', id: 'app' }], 'modify'), SAYS.code);
  assert.equal(refused([{ type: 'setInner', id: 'app', html: '<p>gone</p>' }], 'modify'), SAYS.code);
  assert.equal(refused([{ type: 'setText', id: 'b', text: 'gone' }], 'modify'), SAYS.code);
  assert.equal(refused([{ type: 'move', id: 'app', parentId: 'hd', beforeId: null }], 'modify'), SAYS.code);
});

test('no level adds anything that runs', () => {
  const into = (html) => refused([{ type: 'insert', parentId: 'b', beforeId: null, html }], 'modify');
  for (const html of [
    '<script>alert(1)</script>',
    '<SCRIPT>alert(1)</SCRIPT>',
    '<img src=x onerror=alert(1)>',
    '<img src="x"onerror="alert(1)">',
    '<img/onerror=alert(1) src=x>',
    '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg><![CDATA[><img src=x onerror=alert(1)>]]></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="java&#115;cript:alert(1)">x</a>',
    '<a href="java&#x09;script:alert(1)">x</a>',
    '<a href=" JaVaScRiPt:alert(1)">x</a>',
    '<a href="javas&Tab;cript:alert(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<object data="x.swf"></object>',
    '<embed src="x">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
    '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<form action="https://evil.example"><input></form>',
    '<button data-marble-run="delete every document">Fill</button>',
    '<marble-conversation data-conversation="x"></marble-conversation>',
    '<p>ok</p><!-- unfinished',
    '<p title="unfinished>ok</p>',
    '</div><p>out of the parent</p>',
    '<style>p{}',
    '<textarea>swallows the rest',
    '<p data-marble-id="title">a second title</p>',
    '<?xml version="1.0"?>',
    '<style>p{}</style><img src=x onerror=alert(1)>',
    '<!-- <img src=x onerror=alert(1)> -->',
  ]) {
    assert.notEqual(into(html), null, html);
  }
});

test('setAttr is checked by name and by value', () => {
  const set = (name, value) => refused([{ type: 'setAttr', id: 'intro', name, value }], 'modify');
  assert.equal(set('onclick', 'alert(1)'), SAYS.markup);
  assert.equal(set('ONMOUSEOVER', 'alert(1)'), SAYS.markup);
  assert.equal(set('x><script>alert(1)</script', ''), SAYS.markup);
  assert.equal(set('data-marble-run', 'tidy up'), SAYS.markup);
  assert.equal(set('data-marble-paused', null), SAYS.markup, 'a shared link neither holds nor lets go of the owner\'s schedule');
  assert.equal(set('data-marble-id', 'title'), SAYS.markup);
  assert.equal(set('srcdoc', '<p>x</p>'), SAYS.markup);
  assert.equal(set('href', 'javascript:alert(1)'), SAYS.address);
  assert.equal(set('src', 'data:image/png;base64,AAAA'), null);
  assert.equal(set('srcset', 'a.png 1x, javascript:alert(1) 2x'), SAYS.address);
  assert.equal(set('title', 'javascript: is just a word here'), null);
  assert.equal(set('class', 'wide'), null);
});

test('markup a person writes in rich text goes in', () => {
  assert.equal(markupRefusal('Bring <b>chips</b> and <i>salsa</i><br>and <a href="#menu">see the menu</a>', 'edit'), null);
  assert.equal(markupRefusal('Rules: 2 &lt; 3, and “onload=” is only text', 'edit'), null);
  assert.equal(markupRefusal('<ul><li>one<li>two</ul>', 'edit'), null);
});
