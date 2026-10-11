// An outside write must never be relayed to open tabs as a removal of the
// document's own html, head or body: applied, it empties the page, and the
// tab's write-back then truncates the file. Such a change is a reload.

import assert from 'node:assert/strict';
import test from 'node:test';

import { rootRemoved } from '../server/app.js';

const DOC = '<!doctype html>\n<html><head data-marble-id="hd"><title>T</title></head>\n<body data-marble-id="b1">\n<h1 data-marble-id="h1">Title</h1>\n</body></html>\n';

test('a remove of the body, head or html is a root removal', () => {
  assert.equal(rootRemoved(DOC, [{ type: 'remove', id: 'b1' }]), true);
  assert.equal(rootRemoved(DOC, [{ type: 'setText', id: 'h1', text: 'x' }, { type: 'remove', id: 'hd' }]), true);
});

test('removing a child, or anything in a document whose roots carry no id, is not', () => {
  assert.equal(rootRemoved(DOC, [{ type: 'remove', id: 'h1' }, { type: 'insert', html: '<p></p>', parentId: 'b1', beforeId: null }]), false);
  assert.equal(rootRemoved('<html><body><h1 data-marble-id="h1">T</h1></body></html>', [{ type: 'remove', id: 'h1' }]), false);
  assert.equal(rootRemoved(DOC, []), false);
  assert.equal(rootRemoved(DOC, null), false);
});
