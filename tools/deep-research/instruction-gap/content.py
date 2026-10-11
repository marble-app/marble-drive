# -*- coding: utf-8 -*-
"""Content for "The Instruction Gap" — how close prior work gets to the claim
that generative design guidance is a different kind of document.

Verification: every item here was checked on 2026-09-20 either by fetching the
primary source or, where marked, from a search snippet only.
"""

TITLE_SHORT = 'The Instruction Gap'
KICKER = 'Deep research · positioning note'
DATE = 'September 2026'
TITLE = 'The instruction gap: what a generator must be told that a designer never was'
BYLINE = 'How close twenty prior works get to the claim, what each is missing, and an honest read on how well the claim is currently stated.'
QUESTION = 'Every design system describes decisions already made. A generator needs to be told how to make decisions nobody has made yet. Is that a difference in kind?'
USE_NOTE = 'Type over any sentence and it is changed on disk. Drag a difference to reorder it, mark what you have read, add your own. Mod+Z takes back the last thing you did.'

ANSWER = [
 '<span class="label-inline">Short answer.</span> The gap is real, it is narrower than it was a week ago, and the part of it you have actually articulated is the weakest part.',
 'Two artefacts moved into your territory in 2026. Google Labs open-sourced <b>DESIGN.md</b> in April, a format that pairs machine-readable tokens with prose rationale and Do’s and Don’ts, under the line “tokens give agents exact values, prose tells them why.” Meta open-sourced <b>Astryx</b> in June, a design system built to be agent-operable rather than retrofitted. Both are addressed to a model reader. Neither tells the model how to decide anything that has not already been decided.',
 'That distinction survives every check I ran, and it is the whole of your contribution. It is also not what you have been saying. You have been saying “design the instructions,” which a reviewer will read as prompt engineering, and “likely different from conventional UI guidance,” without naming one difference.',
 'This note names eight of them, plots where twenty works sit relative to them, and says plainly where the argument is thin.',
]
FOOT = 'A positioning note, written to be argued with. Nothing here is settled.'

# --------------------------------------------------------------- the claim
CLAIM_STRENGTHS = [
 dict(key='weak', label='Weak', verdict='Not a paper',
      text='Generative UI works better when you write good instructions for the generator.',
      note='Nobody disagrees. Every team shipping GenUI already does this. Google’s paper describes its system instruction in a paragraph and moves on. A position paper making this claim would be describing current practice.'),
 dict(key='mid', label='Middle', verdict='Already claimed',
      text='Design knowledge should be authored in a machine-readable form so generators can consume it.',
      note='This is the AI-ready design system movement, and it is crowded. DESIGN.md, Astryx, Spotify’s Encore, Builder.io, Supernova. Google published a format for it five months ago. Arriving here in late 2026 is arriving second.'),
 dict(key='strong', label='Strong', verdict='Open, and contestable', ours=True,
      text='Conventional design knowledge is structurally insufficient for a generator, because it records decisions already made and a generator needs procedures for decisions not yet made. Generative design guidance is therefore a different genre of document, with its own content types, and authoring it is a distinct design activity.',
      note='This is falsifiable. It is false if the decision procedures turn out to be derivable from existing design knowledge, or if generators do fine without them. It is the only version worth writing, and it is the version you have not yet been stating.'),
]

# ------------------------------------------------------- figure 1: the map
# x: who the guidance addresses (0 = a human designer, 100 = a model deciding alone)
# y: what it encodes (0 = decisions already made, 100 = how to make decisions not yet made)
MAP_POINTS = [
 dict(key='heuristics', x=6, y=18, la='up', label='Nielsen heuristics', kind='conv',
      note='Ten principles describing properties a finished interface should have. Addressed to a person who will exercise judgment. Silent on how to choose between two interfaces that both satisfy them.'),
 dict(key='material',  x=9, y=8, la='down',  label='Material, HIG', kind='conv',
      note='A conventional design system. Enumerates components, states, spacing and usage. Every statement is a decision already taken, addressed to a reader who can ask a colleague when the document does not cover the case.'),
 dict(key='nng',       x=34, y=33, la='up', label='NN/g must / should / never', kind='conv',
      note='Moran and Gibbons ask designers to sort content into must show, should show, never show. This is the first widely read move toward writing rules rather than screens. It is a content policy, addressed to designers, and it says nothing about layout decisions under uncertainty.'),
 dict(key='builder',   x=67, y=22, la='left', label='Builder.io schemas', kind='ind',
      note='Argues for baking taste into the component’s API schema so the agent plays by your rules. The mechanism is constraint through types. A schema can forbid an invalid state; it cannot express which of two valid states to prefer.'),
 dict(key='encore',    x=76, y=14, la='up', label='Spotify Encore', kind='ind',
      note='Rewrote docs to be machine-readable, split components into foundation, style and behaviour layers for smaller context bubbles, built a lint-and-diff harness. The restructuring is real and the content is the same content.'),
 dict(key='astryx',    x=89, y=7, la='left',  label='Astryx (Meta)', kind='ind',
      note='Open-sourced June 2026, MIT, eight years internal, 13,000 apps, 150+ components. Agent-readable through a self-describing JSON manifest from the CLI, JSDoc composition hints, and an MCP server. Verified: the content is identical for agents and humans. Only the delivery is structured. This is the largest agent-first design system in existence and it changes nothing about what is said.'),
 dict(key='designmd',  x=86, y=38, la='left', label='DESIGN.md (Google)', kind='ind', near=True,
      note='The nearest artefact to your idea. YAML front matter carries tokens, Markdown prose carries rationale, and the spec’s own sentence is that tokens give agents exact values while prose tells them why. Includes Do’s and Don’ts. Apache 2.0, alpha, April 2026. It explains why the palette is what it is. It does not say what to do when the content does not fit the palette.'),
 dict(key='a2ui',      x=80, y=4, la='left',  label='A2UI catalog', kind='ind',
      note='A flat JSON component list the agent may compose from. Pure vocabulary restriction. Guidance by subtraction: the agent cannot do the wrong thing because the wrong thing is not in the catalog. No statement about preference at all.'),
 dict(key='sysprompt', x=93, y=47, la='left', label='Google’s system instruction', kind='ind', near=True,
      note='Described in the Google paper as covering goals, examples, technical specifications and error prevention. Error prevention is decision guidance. This is probably the most advanced instance of your idea that exists, and it is proprietary, undocumented as a design artefact, and never studied as one. Its existence is an argument for your paper, not against it.'),
 dict(key='maru',      x=80, y=61, la='left', label='Maru (IA persistence)', kind='hci', near=True,
      note='Captures partition, hierarchy, order and vocabulary as persistent rules that survive regeneration. This is the one academic system that genuinely encodes what must not move. It is the closest published work to difference three, and it is scoped to information architecture only.'),
 dict(key='jelly',     x=68, y=41, la='up', label='Jelly (data model)', kind='hci',
      note='The generated artefact is a task-driven data model rather than code, and people edit it. Constrains generation through representation. The model is a description of what exists, not a procedure for choosing.'),
 dict(key='irs',       x=73, y=30, la='right', label='Athena, SQUIRE', kind='hci',
      note='Apple’s intermediate-representation line. Slot and skeleton representations with guarantees about what a request will and will not mutate. Guarantees are close to invariants, which is close to difference three, but they are enforced by the representation rather than written as guidance.'),
 dict(key='gulfs',     x=49, y=46, la='up', label='Bridging Gulfs', kind='hci',
      note='Thematically analyses UI prompting guidelines and surfaces hierarchical, interdependent design semantics. The closest anyone has come to studying what this guidance contains. Aimed at helping the user express intent, not at the designer authoring the guidance.'),
 dict(key='gradual',   x=59, y=66, la='up', label='Gradual Generation (yours)', kind='hci', ours=True,
      note='Stages the dimensions along which generation unfolds and lets people wind it back. A staging is a statement about when the generator may vary what, which is decision guidance in structural form. You already built an instance of your own thesis and did not frame it that way.'),
 dict(key='uicrit',    x=88, y=25, la='left', label='UICrit as reward model', kind='hci',
      note='Designer critiques packaged as training signal. Design judgment made machine-consumable, but as a score rather than a rule. A reward model cannot be read, argued with, or edited by the designer.'),
 dict(key='specifyui', x=63, y=35, la='left', label='SpecifyUI', kind='hci',
      note='A structured, parameterised, hierarchical specification exposing UI elements as controllable parameters, extracted from references. Another representation, not a procedure. Search-snippet verification only.', unverified=True),
 dict(key='modelspec', x=96, y=85, la='left', label='OpenAI Model Spec', kind='other', near=True,
      note='The document your idea already exists as, in another domain. Authority levels from root to guideline, explicit supersession when instructions collide, and named strategies for ambiguity: ask a clarifying question, err toward caution in agentic contexts by minimising expected irreversible costs, or state assumptions and proceed. When two root principles conflict, default to inaction. Nothing like this exists for interface design.'),
 dict(key='constdd',   x=97, y=67, la='left', label='Constitutional spec-driven dev', kind='other',
      note='A constitution at the apex governing specifications and plans for AI-assisted code generation, with the finding that including rationale alongside the constraint and the pattern enabled appropriate decisions in edge cases. That finding is your thesis, demonstrated for code security rather than for interfaces.'),
 dict(key='anthropic', x=92, y=76, la='left', label='Model constitutions', kind='other',
      note='The broader genre. Documents written for a model reader whose entire content is how to behave in situations the author did not enumerate. The genre exists and is taken seriously. It has no counterpart in design.'),
 dict(key='thesis',    x=89, y=93, la='left', label='Your claim', kind='thesis', ours=True,
      note='A document addressed to a generator, for the interface domain, whose content is decision procedures rather than decisions. The quadrant is empty of UI work. Everything at this height is from another field, and everything at this horizontal position is at the bottom.'),
]

MAP_LEGEND = [
 dict(kind='conv',   label='Conventional design guidance'),
 dict(kind='ind',    label='Industry formats and systems'),
 dict(kind='hci',    label='HCI research'),
 dict(kind='other',  label='Same idea, another domain'),
 dict(kind='thesis', label='Your claim'),
]

FIG1_CAPTION = '<b>Figure 1.</b> Twenty works placed by who the guidance addresses and what it encodes. Click any point. The argument is the empty region: the upper right holds nothing from interface design. The three things that reach that height are an assistant-behaviour spec, a code-security constitution, and a genre of model constitution. Two interface works climb: Maru and your own Gradual Generation, both stalling around the middle. Above them there is nothing from interface design at all.'

# ---------------------------------------------- the differences (specimens)
DIFFERENCES = [
 dict(key='uncert', n='01', title='What to do when nothing fits',
      now='Silence. No design system addresses it, because the human reader asks a colleague, checks a precedent, or uses judgment. The case never had to be written down.',
      need='“When the content matches no documented pattern, prefer the most conservative available layout, do not invent a component, and surface a note saying which pattern was closest.”',
      who='Nobody. Google’s system instruction reportedly covers error prevention, which is the nearest, and it is unpublished.',
      state='open'),
 dict(key='tie', n='02', title='Which of two acceptable options to take',
      now='DESIGN.md: “Tertiary (#B8422E): Boston Clay — the sole driver for interaction.” True, useful, and a statement about what the system contains.',
      need='“When a table and a card grid both satisfy the density rule, choose the table if any column is sortable, otherwise cards. If still tied, match whichever the person saw last.”',
      who='Nobody in design. The Model Spec does exactly this for assistant behaviour, with supersession by recency and explicit precedence.',
      state='open'),
 dict(key='fixed', n='03', title='What must not move next time',
      now='Silence, and for a structural reason. A human designer does not regenerate the screen, so consistency is a free consequence of there being one artefact. No guideline has ever needed to name it.',
      need='“Once a partition is established in a session, do not repartition. The primary action keeps its position and label across every generation until the person changes it.”',
      who='Maru, alone, and only for information architecture. Apple’s slot representations enforce a version of it structurally rather than stating it.',
      state='partial'),
 dict(key='variance', n='04', title='How much two instances may differ',
      now='Silence. Conventional design has no concept of acceptable variance because there is exactly one instance. The question is not answerable in the old vocabulary.',
      need='“Two generations for the same task may differ in the ordering of secondary content. They may not differ in the primary action, the navigation depth, or the vocabulary used for the same object.”',
      who='Nobody. EvoGenUI-Bench measures the failure and proposes no guidance. This may be the single emptiest cell.',
      state='empty'),
 dict(key='ask', n='05', title='When to ask instead of deciding',
      now='Silence. No design system tells anyone when to escalate, because escalation is a social act the document does not mediate.',
      need='“If confidence in the intended grouping is below threshold, present two candidate groupings rather than choosing one. Never ask about anything the person has already settled this session.”',
      who='Nobody in published design work. Your own decide pipeline gates on confidence and is an unwritten instance. The Model Spec names asking as one of three ambiguity strategies.',
      state='open'),
 dict(key='negative', n='06', title='What must never be generated',
      now='Conventional guidance is overwhelmingly positive: here is what good looks like. DESIGN.md’s Do’s and Don’ts is the nearest published instance and it is scoped to brand application.',
      need='“Never introduce a colour outside the palette. Never add a navigation level. Never generate a settings surface. Never replace a control the person has customised.”',
      who='Partially DESIGN.md. Partially A2UI, by making the forbidden thing absent from the catalog rather than naming it.',
      state='partial'),
 dict(key='precede', n='07', title='Which instruction wins when two conflict',
      now='Silence. A designer resolves a conflict between brand and usability by judgment, in a meeting, and the resolution is never written back into the system.',
      need='An authority order. Accessibility outranks brand outranks task convenience outranks aesthetic preference, with a stated default when two rules at the same level collide.',
      who='Nobody in design. The Model Spec is built around exactly this, root through system, developer, user and guideline, with inaction as the default when two root principles conflict.',
      state='empty'),
 dict(key='person', n='08', title='What this person has already established',
      now='Silence. A design system describes the product, not the reader. There is no slot for an accumulated per-person preference because the artefact is shared.',
      need='“Preferences the person has expressed by direct manipulation outrank inferred ones. A layout they corrected once is not to be re-proposed.”',
      who='Nobody as guidance. Efficient Personalization shows the need empirically, with rater agreement at 0.25, and solves it with a learned weighting rather than a written rule.',
      state='empty'),
]

FIG2_CAPTION = '<b>Figure 2.</b> Eight kinds of statement, against the artefacts that might carry them. Green is expressible today, amber is partial or structural rather than stated, blank means the format has no way to say it. Click any cell. Astryx expresses none of the eight. Precedence is the one row no interface artefact touches at all.'

# rows = DIFFERENCES keys, cols = artefacts
MATRIX_COLS = [
 dict(key='conv',  label='Conven-\ntional'),
 dict(key='dmd',   label='DESIGN\n.md'),
 dict(key='astryx',label='Astryx'),
 dict(key='a2ui',  label='A2UI'),
 dict(key='sys',   label='System\nprompt'),
 dict(key='maru',  label='Maru'),
 dict(key='spec',  label='Model\nSpec'),
]
# '' = cannot express, 'part' = partial/structural, 'yes' = expressible
MATRIX = {
 'uncert':  dict(conv='', dmd='', astryx='', a2ui='', sys='part', maru='', spec='yes'),
 'tie':     dict(conv='', dmd='part', astryx='', a2ui='', sys='part', maru='', spec='yes'),
 'fixed':   dict(conv='', dmd='', astryx='', a2ui='', sys='', maru='yes', spec='part'),
 'variance':dict(conv='', dmd='', astryx='', a2ui='', sys='', maru='part', spec=''),
 'ask':     dict(conv='', dmd='', astryx='', a2ui='', sys='part', maru='', spec='yes'),
 'negative':dict(conv='part', dmd='yes', astryx='', a2ui='part', sys='part', maru='', spec='yes'),
 'precede': dict(conv='', dmd='', astryx='', a2ui='', sys='', maru='', spec='yes'),
 'person':  dict(conv='', dmd='', astryx='', a2ui='', sys='', maru='part', spec='part'),
}

# --------------------------------------------------------- honest appraisal
APPRAISAL_GOOD = [
 dict(head='The quadrant really is empty.', body='I looked for it four ways and did not find an interface-design document whose content is decision procedure. The nearest things are a proprietary system instruction nobody has written about and a specification for assistant behaviour in a different field. That is a genuine opening, not a gap manufactured by narrow reading.'),
 dict(head='You have already built three instances.', body='Gradual Generation stages what may vary and when. Malleable ODI names the dimensions a pattern moves along. Your decide pipeline gates a generation choice on a confidence threshold, which is difference five implemented. A position paper that induces the genre from artefacts you built is far stronger than one that proposes it in the abstract.'),
 dict(head='The analogy is available and nobody has used it.', body='Assistant behaviour got a written specification with precedence and tie-breaks. Code generation got a constitution, and the paper reports that rationale alongside constraint improved edge-case decisions. Interface design has neither. Borrowing that structure is a legitimate and unclaimed move.'),
 dict(head='Timing is still on your side, barely.', body='DESIGN.md is alpha and its own repository says to expect the format to change. Critiquing a live alpha is a stronger position than critiquing a settled standard, and it gives the paper a concrete object instead of a hypothetical.'),
]

APPRAISAL_BAD = [
 dict(head='“Instructions” is the wrong word and it will cost you the argument.',
      body='Every reader maps it to prompt engineering within one sentence. The first reviewer comment will be that this is prompting with extra steps. You need a term for the artefact that is not instructions, not prompt, and not guidelines. DESIGN.md has a name. A2UI has a name. Your thing does not, and unnamed contributions get absorbed into whatever nearby thing does have a name.'),
 dict(head='You have not named a single difference in your own words.',
      body='You said generative guidance is “likely different from what conventional UIs would accept.” Likely, and unspecified. Every difference in this document came out of my analysis rather than yours. If the person holding the thesis cannot name three differences without help, the thesis is not ready to be posted, and a reviewer will find that out faster than you would like.'),
 dict(head='You are oscillating between three claims of very different strength.',
      body='In one sentence you have the weak claim, which is current practice, the middle claim, which Google shipped in April, and the strong claim, which is open. Readers will assume the weakest reading that makes your sentences true. You have to state the strong version first and defend it explicitly against the other two, in the abstract, not in section four.'),
 dict(head='You have not differentiated from machine-readable design systems, and it is the obvious collapse.',
      body='I supplied the distinction between porting existing knowledge and authoring new content. You did not. That distinction is the entire load-bearing structure of the paper, and if it is not in your first paragraph the reader will file this under AI-ready design systems and stop.'),
 dict(head='The claim is currently an assertion with no evidence behind it.',
      body='Nothing in what you have said would convince a sceptic. The cheapest fix is the study nobody has run: hand a real conventional guidance corpus to a generator and document where it underspecifies, where it is silent, and where it actively misleads. That converts the whole argument from a position into a finding and it is a few weeks of work.'),
 dict(head='There is a real chance this is subsumed within a year.',
      body='DESIGN.md already has rationale, Do’s and Don’ts, and a CLI. Adding precedence rules and uncertainty defaults is an obvious next version for a team that has already built the two-layer format. If Google ships that before you publish, your contribution becomes a description of someone else’s file format.'),
]

VERDICT = ('The idea is better than your statement of it, by a wide margin. The gap is real and the quadrant '
           'is empty. But right now you are one reviewer sentence away from being read as prompt engineering, '
           'because the strong version is unstated, the differences are unnamed, and the evidence does not exist '
           'yet. All three are fixable in weeks, and two of them are fixable this afternoon.')

QUESTIONS = [
 'What is the artefact called? Not instructions, not prompt, not guidelines. Until it has a name it will be absorbed by DESIGN.md.',
 'Is the difference in kind or only in completeness? A sceptic will say conventional guidance is silent on these cases because they were obvious to a competent reader, not because the knowledge is a different type.',
 'Are decision procedures authored, or learned? Efficient Personalization gets the same effect from a few pairwise judgements without writing anything down. If learning wins, the design activity you are proposing does not exist.',
 'Does a generator given decision procedures actually behave better than one given a conventional design system? Nobody has run this, and it is the experiment the claim rests on.',
 'Who writes it? If the answer is a designer, what training do they need that they do not have? If the answer is a model, the activity has moved again.',
 'How does the document stay honest as the generator changes? Guidance tuned to one model is not obviously portable, and Design Theater already shows stated rationale drifting from shipped behaviour.',
]
