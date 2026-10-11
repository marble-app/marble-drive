# Content for the Deep Research report: designing GenUI as its own activity.
from sources_acad import ACAD
from sources_ind import IND
from sources_disc import DISC
from sources_eval import EVAL
from sources_agent import AGENT

TITLE_SHORT = 'Designing GenUI — deep research'
KICKER = 'Deep research · designing generative interfaces'
DATE = 'September 2026'
TITLE = 'Is designing a generative interface its own kind of design?'
BYLINE = 'A reading of {n} sources across HCI, industry and the design discourse, 2024 to September 2026, gathered by four parallel scans on 20 September 2026.'
QUESTION = 'Not “can a model generate a screen?” but “what is the designer designing when the screen is generated, and who checks that it worked?”'
USE_NOTE = 'Type over any sentence and it is changed on disk. Drag a source to reorder or reclassify it, mark what you have read, and add questions at the end. Mod+Z takes back the last thing you did.'
ANSWER = [
 '<span class="label-inline">Short answer.</span> Yes, and by 2026 nearly everyone says so. The disagreement is about what the new object of design is, and it runs along one line: how much of the interface the model is allowed to author.',
 'HCI has converged on a move up a level: the designer specifies the thing that generates the screen, whether that is a policy, a data model, an information architecture, a staged customisation space, a semantic intermediate representation or an inferred objective. Industry has converged on the same move by a different route: the catalog, the schema and the sandbox have replaced the prompt as the unit of design, and free generation of whole surfaces is kept for places where one company owns everything.',
 'What neither has is a way to evaluate the result. Every benchmark judges one output, by preference or by whether an agent can traverse it. The single benchmark that follows an interface across turns finds the best model completing about a third of five-turn episodes. Nothing measures learnability across variants, consistency between two people’s generated interfaces, or a month of use.',
 'So the gap is specific. The field can say what the designer authors and can rank what the model emits. It cannot yet say what a <em>good space</em> of interfaces is, or tell a person that the one they got today is the same tool they learned yesterday.',
]
FOOT = 'A living note. Every claim here is editable, and the source list is deliberately incomplete.'

GROUPS = {
 'acad':  dict(label='HCI research · 2024 to 2026', tag='HCI',
               dek='Systems, definitions, taxonomies and position papers from CHI, DIS, UIST, VL/HCC and arXiv cs.HC.'),
 'ind':   dict(label='Industry · products, protocols and guidelines', tag='Industry',
               dek='What shipped, what the SDKs allow, and who holds the guardrails.'),
 'disc':  dict(label='Discourse · design theory and practitioners', tag='Essay',
               dek='The essays that argue about which degree of generation is the right one.'),
 'eval':  dict(label='Evaluation · benchmarks and studies', tag='Eval',
               dek='How generated interfaces are being judged, and what the judges cannot see.'),
 'agent': dict(label='Agents in the interface', tag='Agents',
               dek='Agents that live in the document, the canvas or the page rather than beside it.'),
}
SOURCES = ACAD + IND + DISC + EVAL + AGENT
SOURCE_BY_KEY = {s['key']: s for s in SOURCES}

# ---------------------------------------------------------------- figure 1
STEP_DEFAULT = 6
STAGES = [
 dict(name='Fixed', short='the model is absent',
      text='A designer authors one screen and every person gets it. Linear’s agent guidelines sit here on purpose: agents act through the existing UI and generate nothing.'),
 dict(name='Adaptive', short='rules pick among variants',
      text='The designer authors variants and rules, or a model, choose among them. The lineage runs back through adaptive interfaces; Clark’s sentient design and the AI SDK’s tool-to-component mapping are its current form.'),
 dict(name='Slotted', short='the model fills a frame',
      text='The designer authors the frame and the model fills slots: ChatKit widgets, Adaptive Cards, NN/g’s must-show, should-show and never-show lists. The frame is the design.'),
 dict(name='Composed', short='the model assembles a catalog',
      text='The designer authors a catalog and constraints; the model composes screens from it at run time: A2UI, thesys C1, Salesforce’s Lightning types, Hall’s bounded dynamic surface. The catalog is the design.'),
 dict(name='Generated', short='the model writes the screen',
      text='The model authors whole screens as code from a prompt and a design system: Gemini’s dynamic view, Search’s mini apps, Claude Design, Shopify Sidekick, the Google paper. The system prompt and the post-processing are the design.'),
 dict(name='Authored space', short='the designer writes the space',
      text='The designer authors the space of interfaces and the elicitation that moves through it; the model and the person navigate it together: Malleable ODI, Gradual Generation, Jelly, Maru, Marble. The space and its staging are the design.'),
]
FIG1_CAPTION = '<b>Figure 1.</b> Six degrees of generation, ordered by how much of the interface the model authors. Step through them or click one. The discourse’s sharpest fight is between five and four. The HCI design methods sit at six, which is less a point on the line than a claim about what the line is.'

# ---------------------------------------------------------------- figure 2
CELL_DEFAULT = 'unit-acad'
MATRIX_ROWS = [
 dict(key='unit',   label='What is designed', sub='the object the designer hands over'),
 dict(key='author', label='Who authors',      sub='designer, model, person, and when'),
 dict(key='intent', label='How intent is learned', sub='elicitation, specification, steering'),
 dict(key='eval',   label='How it is judged', sub='benchmarks, studies, metrics'),
 dict(key='cont',   label='Whether it holds', sub='consistency, persistence, learnability'),
]
MATRIX_COLS = [dict(key='acad', label='HCI'), dict(key='ind', label='Industry'), dict(key='disc', label='Discourse')]
MATRIX_CELLS = {
 ('unit','acad'):   dict(refs=['jelly','maru','gradual','modi','athena','squire','pott','ryskeldiev','saac'],
                         note='The densest cell. Nine different answers to what the designer hands over: a data model, an information architecture, a staging, a pattern’s dimensions, an intermediate representation, a policy, a lifecycle.'),
 ('unit','ind'):    dict(refs=['a2ui','chatkit','microsoft','thesys','spectrum','spotify'],
                         note='The catalog and the schema. Industry’s answer is one thing said six ways: the component set stays out of the model’s hands.'),
 ('unit','disc'):   dict(refs=['nng','nielsen2026','moore','clark','hall'],
                         note='Parameters and constraints, policy surfaces, machine-legible design systems, the bounded surface.'),
 ('author','acad'): dict(refs=['lee','w66','eardley','duetui','jit','sreedhar','taleoftwo','genuistudy'],
                         note='Three authors at once, and a split over whether the activity happens at design time or at run time.'),
 ('author','ind'):  dict(refs=['gemini','searchgenui','appssdk','mcpapps','claudedesign','figma','stitch','salesforce','shopify'],
                         note='Who holds the guardrails, product by product. Free generation only where one company owns everything, or at design time where a person edits first.'),
 ('author','disc'): dict(refs=['nielsen2023','nielsena11y','a16z','appleton','inkswitch','saarinen','nielsengemini'],
                         note='The argument over whether the designer drops out, the model takes over, or the person does.'),
 ('intent','acad'): dict(refs=['gulfs','jit','duetui','geninterfaces','dynavis','biscuit','misty','gradual'],
                         note='Where HCI is richest: intermediate representations, inferred objectives, manipulation as specification, examples as input.'),
 ('intent','ind'):  dict(refs=['vercel','spectrum'], gap=True,
                         note='Industry reads intent as a tool call. Almost nothing here learns what a person wants beyond the prompt.'),
 ('intent','disc'): dict(refs=['wattenberger','nielsen2023','nng'], gap=True,
                         note='The affordance objection to chat and the outcome idea, with nothing on how an outcome gets elicited.'),
 ('eval','acad'):   dict(refs=['google','geninterfaces','theater','personal','evogenui','floweval','cuajudge','espp','synthheur','uicrit','uibench','looksgood','conventional'],
                         note='Many benchmarks, one shape: a single output judged by preference or traversability. One benchmark follows an interface across turns.'),
 ('eval','ind'):    dict(refs=['gemini','spotify'], gap=True,
                         note='Rater preference against expert pages, and a lint-and-diff harness for on-system code. No usability, no learnability.'),
 ('eval','disc'):   dict(refs=['wong','eardley','w66'], gap=True,
                         note='The objections name what evaluation misses (consistency, information architecture, regulation) without measuring it.'),
 ('cont','acad'):   dict(refs=['maru','jelly','evogenui','theater','sreedhar','debt'],
                         note='Persistence and drift. Maru and Jelly keep a representation; EvoGenUI-Bench measures what happens when nothing does.'),
 ('cont','ind'):    dict(refs=['searchgenui','microsoft','spotify'], gap=True,
                         note='Persistent mini apps and fixed form fields: consistency handled as a product promise, not a measured property.'),
 ('cont','disc'):   dict(refs=['wong','hall','saarinen','nielsengemini','nng'],
                         note='The consistency fight lives here. Whether a person relearns the interface every time is argued, not measured.'),
}
FIG2_CAPTION = '<b>Figure 2.</b> Coverage by concern and field. Click a cell for what lands in it. The dashed cells are the thin ones: industry and the discourse on intent, nearly everyone on evaluation, and industry on whether a generated interface holds.'

# ---------------------------------------------------------------- positions
POSITIONS = [
 dict(name='Outcome specification', who='Nielsen 2023 and 2026; Moran and Gibbons; Moore; Ryskeldiev',
      text='The designer stops drawing screens and writes the rules a generator obeys: must, should and never-show lists, design tokens, policy surfaces, machine-legible component schemas, policies rather than layouts. The screen is an output; the specification is the work.'),
 dict(name='Disposable, individualised UI', who='Nielsen 2024 and 2025; Google Research; a16z',
      text='The interface is cheap, disposable, per-person content, and for a fixed data model it can be inferred instead of designed. What remains for designers is upstream, in what Nielsen calls UX anthropology.'),
 dict(name='Generation inside a stable frame', who='Clark; Hall; CopilotKit; Saarinen; Microsoft',
      text='AI is a design material that morphs content inside a deterministic core: bounded surfaces, curated registries, the workbench. Consistency and learnability are the product, and about four fifths of the interface must stay familiar.'),
 dict(name='Malleable and personal software', who='Litt, Horowitz, van Hardenberg and Matthews; Appleton; Marble', ours=True,
      text='Bespoke interfaces come from people reshaping tools on a malleable substrate; a model without that substrate is a sous chef in a food court. The change belongs to the person, not to the run-time model.'),
 dict(name='The objections', who='Wong; Lindley et al.; Eardley and Tonkin; Nielsen’s own commenters',
      text='Consistency and the support cost; the loss of the shared UI as common ground; untestable instances and invisible algorithmic decisions; accountability for what generation leaves out; shared devices. And Lee’s definitional objection: much of the field means design-time co-creation, not run-time generation.'),
]

# ---------------------------------------------------------------- theses
THESES = [
 dict(key='t1', label='T1 · GenUI Design', paras=[
  '<b>Confirmed, and now crowded.</b> Design the space, not the screen, is the field’s consensus in 2026, stated by NN/g, by the CHI workshop and by Lee’s definition. The distinctive part of T1 is no longer the claim but the method: Gradual Generation and Malleable ODI are two of very few papers that say what the designer actually authors and show a probe of it. The gap Pott and Lee both name, a design method tested with practitioners, is the T1 paper nobody has written.',
  'Position it against Google, not against chat. The comparison the field wants is authored space versus unconstrained generation, matched on the person’s task, with a within-person measure over time.']),
 dict(key='t2', label='T2 · UI Envisioning', paras=[
  '<b>Almost empty in the literature, which is good.</b> Nothing here models what a person can and cannot picture creating. The closest findings are TaskArtisan’s, that people adapted existing patterns rather than inventing, and Sreedhar et al.’s, that modifications stayed near what the interface already did. That is envisioning capability observed and not named.',
  'The Representation Corpus has a direct competitor in the machine-legible design system (Encore, Builder.io, Claude Design’s onboarding of a codebase): both are libraries of ways an interface can be. The difference to defend is that a corpus widens what a person can ask for, and a design system narrows what a model can emit.']),
 dict(key='t3', label='T3 · Personal UX', paras=[
  '<b>Now has an empirical anchor.</b> Efficient Personalization shows people disagree about what a good UI is (an alpha of 0.25) and that a few pairwise judgements beat shared guidelines. That is the Personal UX Model argument, made by Apple and CMU with numbers, and it belongs in the first paragraph of any T3 paper.',
  'The objection to answer is Lindley et al.’s: personal interfaces lose the shared UI as common ground. The Collaboration in Personal UX card is the answer, and nobody else is working on it.']),
 dict(key='ag', label='Agents in the UI', paras=[
  'The stationed-agent idea from the earlier brainstorm sits between the agent-native systems in Section 8 and T2. It is a T2 contribution with a T1 mechanism: uncertainty in the generator becomes a place in the interface where an agent asks. No source here does this. The closest, DOMSteer and Cocoa, put the agent in the document without tying it to generation.']),
]

# ---------------------------------------------------------------- questions
QUESTIONS = [
 'What is a good space of interfaces, as opposed to a good interface? No source offers a measure.',
 'When a person changes a generated interface, whose design changed: the designer’s space, the model’s sample, or the person’s own?',
 'Does a stable frame with a dynamic region (Hall’s four fifths familiar) beat an authored space for a person doing real work over a week?',
 'How does a generated interface prove to a person that it is the same tool they learned yesterday?',
 'If intent is elicited from inside the artefact by an agent, is that agent part of the interface’s design or part of the person’s?',
 'Why have UIST and IUI not hosted this conversation yet, and is that a venue problem or a maturity problem?',
]

# ---------------------------------------------------------------- sections
SECTIONS = [
 dict(key='claim', rail='The claim', title='The claim, and the three shifts it rests on', blocks=[
  ('p', 'That designing generative UI is a different activity from designing conventional UI is a claim, and it is worth saying what would make it false. If the designer still produces screens and the model merely helps, if one party still authors the journey, and if evaluation still tests one screen with one sample of people, then nothing has changed but the tooling. The sources below disagree with each of those conditions, for reasons that are independent of one another.'),
  ('aside', 'origin', 'Where the phrase comes from', 'Moran and Gibbons (2024) named designers of parameters and constraints; Lindley et al.’s CHI 2026 workshop asked how practice should evolve; Lee’s DIS 2025 definition made it a paradigm. The vision doc’s T1 card says it in five words: design the space, not the screen.'),
  ('p', '<b>The unit changes.</b> Nobody in this set ships a screen. Jelly ships a data model. Maru ships an information architecture. Gradual Generation ships the order in which dimensions of customisation unfold. Athena and SQUIRE ship intermediate representations with guarantees about what will not move. A2UI ships a catalog. Nielsen’s 2026 list ships policy surfaces and system temperament. These are not variations on a wireframe. They are different kinds of object, each chosen so that the model’s freedom is bounded by something a person wrote down.', True),
  ('p', '<b>The author changes.</b> In conventional UI the designer authors the journey and the person walks it. Here three parties author at once: the designer at design time, the model at generation time, and the person through use, which JIT Objectives, DuetUI and Sreedhar et al. all treat as a specification act. Lee’s definition insists that design-time co-creation and run-time generation both count, and the two halves of the field have mostly been talking about different halves.', True),
  ('p', '<b>The evaluation unit changes.</b> Peng, Bigham and Wu show that individuals disagree too much about what a good UI is for a shared rubric to exist. Design Theater shows tools do not implement their own rationale. EvoGenUI-Bench shows they cannot hold an interface steady for five turns. If the target is an individual, the artefact is a space, and the failure mode is drift, then a usability test on one screen with twelve people measures the wrong thing, and the field now says so in as many words.', True),
 ]),
 dict(key='degrees', rail='Six degrees of generation', title='Six degrees of generation', blocks=[
  ('p', 'The sources sort themselves by how much of the interface the model is allowed to author, and every argument in the discourse is an argument about which degree is right. Walking through them makes the positions legible.'),
  ('stages',),
  ('p', 'Two things the ordering makes visible. First, the industry protocols cluster at three and four, and the reason is stated in every spec: a declarative format is not executable code, so the client keeps the guardrails. Second, the academic systems that call themselves design methods are not more generative than Google; they are differently authored. Gradual Generation stages what the model may vary, Maru pins the information architecture, Malleable ODI names the three dimensions a pattern varies along. Each is a way to give a person a space without giving the model the whole page.'),
 ]),
 dict(key='hci', rail='What HCI has established', title='What HCI has established since 2024', blocks=[
  ('p', 'The academic record runs from DynaVis at CHI 2024, where a request produced a control rather than an outcome, through two CHI 2025 systems from UC San Diego, to a 2026 wave of preprints and a CHI 2026 workshop that took the question of practice as its whole agenda. UIST and IUI have not yet hosted this conversation. That absence is itself a finding.'),
  ('p', 'Three results are settled enough to build on. <em>Chat is the wrong container</em> for structured, multi-step work: Generative Interfaces, Software as Content and TaskArtisan reach it independently, and each found generated GUIs clearer than chat and stiffer to change. <em>Persistence beats regeneration</em>: Maru’s session-level alignment held where wholesale regeneration drifted, and Jelly keeps the data model so the interface can evolve rather than be replaced. <em>Intent is the new gulf</em>: Bridging Gulfs applies Norman’s gulfs of execution and evaluation to the act of generating, and the fix is an intermediate representation the person can read.', True),
  ('aside', 'elicit', 'The elicitation thread', 'Bridging Gulfs, JIT Objectives, DuetUI and Efficient Personalization are four answers to one question: how the system learns what this person wants without a wizard. That is the Elicitive UIs question, and the field has arrived at it from the evaluation side.'),
  ('p', 'What is contested is the same pair the discourse fights over: constrained representations with guarantees (Apple’s intermediate-representation line, Maru, Jelly) against unconstrained generation judged by preference (Google). What is missing is method. Pott’s taxonomy and Lee’s definition are literature-derived; no design method for the activity has been tested end to end with practitioners. The one field study of end-user malleability, Sreedhar et al., found that the person’s own specification is the failure surface, and nobody has yet designed for that.'),
 ]),
 dict(key='industry', rail='What industry converged on', title='What industry has converged on', blocks=[
  ('p', 'Industry has settled three authoring models and, more quietly, which surfaces get which. Third-party, transactional interfaces get developer-authored web UI in a host sandbox: MCP Apps now runs in Claude, ChatGPT, VS Code and Microsoft 365 Copilot, and every host adds the same guardrails, a sandboxed frame, a JSON-RPC bridge, display modes, a content security policy, house styling, and a rule against rebuilding your app in chat.'),
  ('p', 'First-party, in-product interfaces get a declarative catalog the model composes from: A2UI, ChatKit widgets, Adaptive Cards, thesys C1 and the AI SDK’s tool-to-component mapping all keep the component set out of the model’s hands. Free generation of whole surfaces is reserved for two places: Google’s consumer answer surfaces, where Google owns everything, and design-time tools (Stitch, Claude Design, the Figma agent, v0, Sidekick), where a person edits before anyone else sees the result.'),
  ('aside', 'pileup', 'The pile-up', 'MCP Apps, A2UI, AG-UI, Open-JSON-UI, ChatKit widgets and Adaptive Cards overlap, and the provenance of at least one is unverified. Protocols have displaced prompts as the unit of design, which is industry’s version of the claim in Section 1.'),
  ('p', 'Practitioners report the same list everywhere: latency of a minute or more, inaccuracies, host feature gaps, streaming that leaks half-formatted output, and design-system drift. Spotify’s line is the honest one: the AI is not going to figure it out, it is going to put users on a different path. The response has been to make the design system machine-legible (Encore, Builder.io, Claude Design reading a codebase), which is the constraints-as-the-design-object position implemented as an MCP server.'),
 ]),
 dict(key='positions', rail='Five positions', title='Five positions in the discourse', blocks=[
  ('p', 'The essays argue about which degree is right, and they sort into five positions. The fault line runs between the second and the third.'),
  ('positions',),
  ('p', 'Positions two and three disagree about whether consistency is an artefact of the old paradigm or the thing people actually buy, and the second camp quotes Nielsen’s own heuristic against him. Position four disputes the premise both share, that the model should be the one changing the interface at all. The HCI systems in Section 3 are mostly attempts to have it both ways: a model that changes the interface inside a space a person can hold on to.'),
 ]),
 dict(key='coverage', rail='Where the evidence sits', title='Where the evidence sits', blocks=[
  ('p', 'Laying the sources against the five concerns that make up the activity shows where the work is and where it is thin. A source can land in more than one cell; the counts are sources, not citations.'),
  ('matrix',),
  ('p', 'The shape is a diagonal. HCI is dense on what is designed and how intent is learned; industry is dense on who holds the guardrails; the discourse is dense on whether the result should exist. The bottom row is thin everywhere, and it is the row the activity’s claim depends on: if a generated interface does not hold, then the space was not designed, it was sampled.'),
 ]),
 dict(key='judged', rail='How it is judged', title='How generated interfaces are being judged', blocks=[
  ('p', 'Evaluation has converged on preference and is starting to admit that preference is not enough. The Google paper and UI-Bench rank single outputs pairwise against expert references; Generative Interfaces adds functional, interactive and emotional axes; FlowEval and computer-use-agent judges test whether an interface can be traversed; the persona panel and synthetic heuristic evaluation scale expert critique and concede they cannot see across screens.'),
  ('aside', 'bar', 'Evaluation bar for a design-space claim', 'A within-person measure over time, a matched comparison against the bounded-frame alternative, and a check that the rationale the system shows is the design it shipped.'),
  ('p', 'Three results should change what a study of generative UI measures. Peng, Bigham and Wu: individuals disagree about the same properties, so the target is a person and not a population. Design Theater: a quarter of stated rationales are not implemented, so a rationale is not evidence of a design. EvoGenUI-Bench: models complete about a third of five-turn episodes, so whatever is evaluated on turn one is not what a person will be using on turn five.'),
 ]),
 dict(key='agents', rail='Agents inside the interface', title='Agents inside the interface', blocks=[
  ('p', 'A second literature has grown up beside generative UI and is about to collide with it: agents that live in the interface rather than beside it. Cocoa puts the plan in the document. Magentic-UI turns approval, handoff and background work into named mechanisms. DOMSteer has the agent reshape the live page it is helping with. Figma, Notion and Cursor put the agent’s point of contact on the canvas, in a database, or in a recording. Undo is the universal safety pattern and approval is largely absent.'),
  ('p', 'The two literatures share one design object and do not yet know it. A generative interface needs a way to learn what the person wants next; an in-situ agent is a way to ask from inside the artefact. Nothing in either set stations an agent at the place where a generator was uncertain, or lets a generator hand a person a stub with a tenant. That is the idea sketched earlier in this drive, and this reading suggests it lands in two empty cells: <em>intent</em>, for industry, and <em>whether it holds</em>, for everyone.', True),
 ]),
 dict(key='vision', rail='What it means for the vision', title='What this means for the vision', blocks=[
  ('p', 'Read against the three theses in the Research Vision doc, the landscape confirms the framing and moves two of the bets.'),
  ('theses',),
 ]),
 dict(key='refs', rail='Annotated sources', title='Annotated sources', blocks=[
  ('p', 'Each entry says what the work is, what it says about the activity, and leaves room for notes. Entries marked <span class="conf todo">unverified — check</span> were written from a search snippet alone; read the source before trusting them. Type over anything, drag an entry to reorder it, mark what you have read.', True),
  ('refs',),
 ]),
 dict(key='questions', rail='Open questions', title='Open questions', blocks=[
  ('p', 'The things this reading did not settle. Add to them as you go.'),
  ('questions',),
 ]),
]
