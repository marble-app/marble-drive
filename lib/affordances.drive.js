// Affordance parts that replace Marble's, part-for-part, by name.
//
// `server/gallery.js` reads Marble's `lib/affordances.js` and this file, and
// where both declare a part this one wins. That is the whole mechanism: a part
// is a cut of a closure, so an override only has to keep the same helpers and
// the same contract.
//
// Nothing is overridden today. This file used to replace `sortable` because
// Marble's was HTML5 drag-and-drop, which a finger cannot fire. Marble's
// sortable is pointer-driven now — the same events a finger, a pen and a mouse
// all produce — so a Drive-specific copy would only drift. A future override
// still has a place to live.
