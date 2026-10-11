// A space becomes one TypeSafe request: one Choice per decision, all over the
// same state. Question ids are for code and never reach the model, so every
// question carries its own meaning: which instance, what it shows, and the
// Atlas's own wording for the dimension. Criteria are only the options this
// document implements — the model cannot pick a variation the page cannot show.

export const questionId = (instance, decision) => `${instance.name}.${decision.key}`;

const ASK = 'Choose the best first show for this instance given request and context. Options are the only variations this app implements.';
const ASKED = 'Which of these options, if any, did the person explicitly ask for or clearly describe in the request or in context.signals? Choose none unless they named it or described it unmistakably. This is about what they said, not what would be best.';
export const requestedId = (instance, decision) => `requested.${instance.name}.${decision.key}`;

export function buildQuestions(space, atlas, { request = null, context = {} } = {}) {
  const byName = new Map(space.instances.map((i) => [i.name, i]));
  const state = {
    request: request ?? space.request ?? '',
    context: context ?? {},
    instances: space.instances.map((i) => ({
      name: i.name,
      pattern: atlas.entry(i.pattern)?.name ?? i.pattern,
      about: i.about,
      children: space.instances.filter((c) => c.parent === i.name).map((c) => c.name),
    })),
  };
  const questions = {};
  for (const instance of space.instances) {
    const entry = atlas.entry(instance.pattern);
    for (const decision of instance.decisions) {
      const sub = atlas.sub(instance.pattern, decision.key);
      if (!sub) continue;
      const criteria = {};
      for (const option of decision.options) {
        criteria[option.slug] = option.gloss ?? sub.vars.get(option.slug)?.gloss ?? option.slug;
      }
      questions[questionId(instance, decision)] = {
        type: 'choice',
        instructions: {
          instance: instance.name,
          pattern: entry?.name ?? instance.pattern,
          about: instance.about ?? '',
          parent: instance.parent ? byName.get(instance.parent)?.about ?? instance.parent : null,
          dimension: sub.dim.q ?? sub.dim.name,
          subdimension: sub.sub.name,
          ask: ASK,
        },
        criteria,
      };
      // A request outranks a prior: asked in the same round trip, consumed by
      // the gate only when it names an option.
      questions[requestedId(instance, decision)] = {
        type: 'choice',
        instructions: {
          instance: instance.name,
          pattern: entry?.name ?? instance.pattern,
          dimension: sub.dim.q ?? sub.dim.name,
          subdimension: sub.sub.name,
          ask: ASKED,
        },
        criteria: { none: 'The person did not ask for any of these.', ...criteria },
      };
    }
  }
  return { state, questions };
}
