# Talking to your drive

2026-10-10. The owner asked, by voice: "work on like a text to speech or
speech to text functionality so that I can talk to my Marble Drive … like
talking to Claude just through voice or talking to ChatGPT just through voice.
So I want both sides of the voice to be working so I can just chat with my
drive." So: you speak and the drive's agent hears you; the agent answers
aloud; it should feel like ChatGPT's or Claude's voice mode, and the agent can
still read and change documents while you talk.

The readable copy, with mockups, is the drive page **Notes and Sketches/Agents
and Chat/Voice**. The plan is `docs/superpowers/plans/2026-10-10-voice.md`.
Nothing here is built.

## What is there today

- No microphone capture anywhere in the host, the runtime or the drive. The
  only `MediaRecorder` is a browser test recording a canvas. Mashup Studio
  plays and renders audio; it never records. The "voice notes" in Bryan's
  Days are text dictated through the OS keyboard; the my-day skill only
  guesses a note was spoken from its punctuation (`shapes.mjs:117`).
- `2026-09-18-agents-phone-design.md` §4.2 decided: "No speech recognition.
  iOS Safari's `webkitSpeechRecognition` is unreliable and would be a second
  input path to maintain; the OS keyboard has dictation one tap from this
  field." That still holds for the browser's recogniser (see below). What it
  did not cover is the other half: hearing the answer, and a conversation that
  needs no hands.
- Documents and the runtime load top-level, same origin, with no CSP,
  sandbox or Permissions-Policy on a document (`server/app.js` serves them
  through `injectCarrier`). So the drawer can call `getUserMedia` on any
  document page, on a secure origin (an `https` sprite or front-door name, or
  `127.0.0.1`/`localhost`). The Drive's tile iframes and the
  `sandbox="allow-scripts"` frames of visuals and progress drawings cannot,
  and do not need to. `net=none` is declared in a document, not enforced; the
  runtime still talks only to its own host, and voice keeps it that way.
- Keys: `.agent-keys.local` holds `anthropic`, `cursor` and `openai`
  (`server/agent/keys.js`); the OpenAI one reaches Codex as `CODEX_API_KEY`
  and is checked with `GET /v1/models` (`key-check.js`). `config.openaiBase`
  (`MARBLE_DRIVE_OPENAI_BASE`) already points OpenAI calls at a fake in tests.
  A Codex on the ChatGPT login has no API key, and the login cannot pay for
  the audio APIs.
- How a turn runs and streams: `POST /agent/conversations/:id/turns`
  `{prompt, context, dispatch}` → SSE on `/agent/events` (`text.delta`,
  `text`, `tool.call`, `progress.drawn`, `ask`, `turn.completed` …).
  `MarbleConversation.finish()` (`runtime/agent-ui.js`) is where a turn's last
  `text` is final; the ⌘J line (`runtime/change-line.js` `ended()`) has its
  own copy of the same moment.

## Claude has no voice API

The Anthropic Messages API takes text, images and documents and answers in
text. There is no speech in, no speech out and no realtime voice API; the
voice mode in the Claude apps is not offered to developers. The drive runs
Claude as `claude -p`, which is text on both sides anyway. So "talking to
Claude" is always speech wrapped around a Claude turn: something else hears
you, Claude reads and answers in words, something else speaks them.

Codex is the same: `codex exec --json` is text on both sides. OpenAI is
different only in that it also sells the ears and the voice, and a realtime
voice model that can hand work to an agent.

## The two shapes

**A · Speech around the turn.** Record what you say; the host turns it into
text; that text is an ordinary prompt to the conversation's agent (Claude,
Codex or Cursor, whichever the chat is on); the agent works exactly as it does
today; the host turns the turn's last reply into speech and the browser plays
it.

**B · A voice in front.** A realtime voice model holds the conversation (it
listens and speaks at once, takes interruptions, decides when a turn ends) and
hands anything about the drive to the drive's agent, then says what came back.
OpenAI's `gpt-live-1` (in the API since 2026-09-10, $0.05 a session minute,
"client delegation" to any backend) is built for exactly this; `gpt-realtime-2.1`
with a function tool is the older way to do it.

| | A · speech around the turn | B · a voice in front |
|---|---|---|
| Feels like | a walkie-talkie with a capable colleague: you talk, it works, it answers | a phone call: it answers in under a second and you can talk over it |
| First sound after you stop | about 1 s to transcribe, then the turn (a `claude -p` start is 2–5 s before the first word), then about 0.5 s to the first audio. A question: 4–8 s. A page change: as long as the work | under 1 s for talk; the same as A for anything the agent does, but the voice can fill the wait |
| Who answers | the drive's agent, always. One mind, one transcript | the voice model, which may answer things itself and has to be told to hand over anything about the drive. Two minds |
| Claude | yes, the same as typing | only as the delegated backend; the voice you hear is GPT relaying Claude |
| Codex, Cursor | yes | yes, as the backend |
| Barge-in | press to stop it speaking (v1); talking over it needs echo cancellation (phase 2) | built in |
| Cost on top of the agent | about 2¢ a minute of talk (`gpt-transcribe` $0.0045/min heard; `gpt-4o-mini-tts` about 1.5¢/min spoken) | $0.05 every minute the session is open, waiting included, plus the same agent turns |
| What it adds to the host | two routes that forward to OpenAI | a session broker (ephemeral keys), a delegation bridge into the runner, a second transcript to fold into the first |
| What can go wrong | slow answers on long work; a misheard name | the voice making things up about a page it did not read; an interrupt that stops the talk but not the agent's work; spend while idle |

**v1 is A.** The point of talking to the drive, rather than to ChatGPT, is that
the thing you talk to can open your pages and change them, with the same
rules, marks, undo and history as typing. A keeps that whole: a spoken prompt
*is* a prompt, so every provider, mode, ask, queue and undo works on day one,
and there is one conversation to read later. It is also the only shape in
which "talking to Claude" means Claude answering. What it gives up is speed on
small talk, and that is what B adds in v2: the live voice in front, handing
the work to the same conversation, for people who want the phone-call feel and
will pay the minute rate for it.

## Ears: speech to text

| Option | Latency | Cost | Privacy | iPhone | Verdict |
|---|---|---|---|---|---|
| Browser `SpeechRecognition` (Web Speech) | live partial words | free | Chrome sends the audio to Google, under no key or setting of ours; Safari to Apple | `webkitSpeechRecognition` exists but stops and restarts on its own, and misses words (the 2026-09-18 finding) | **no**: a second, unreliable path, and a third company nobody chose |
| OpenAI `gpt-transcribe` on a finished clip, through the host | about 0.5–1.5 s after you stop, for a sentence | $0.0045 a minute | the host forwards the clip; OpenAI keeps API data up to 30 days for abuse checks and does not train on it by default | `MediaRecorder` records `audio/mp4` on iOS Safari 14.3+; the endpoint takes mp4 and webm | **v1** |
| OpenAI `gpt-4o-transcribe` / `-mini` / `whisper-1` | the same | $0.003–0.006 a minute | the same | the same | fallbacks if `gpt-transcribe` misbehaves; `whisper-1` takes a free-text `prompt` instead of `keywords` |
| Streaming transcription (`gpt-live-transcribe`, the realtime transcription session) | words appear as you speak | $0.017 a minute | the same | yes, over WebRTC | later: needs a socket relay or a browser connection to OpenAI, for words you will see a second later anyway |
| whisper.cpp on the home machine | fast on a GPU, 2–5× real time on a CPU with `large-v3-turbo` | free | nothing leaves the house | yes (the phone sends the clip home) | **later, as an option** for a drive at home: a binary and a 1.5 GB model to install, a GPU that WSL2 may or may not see, and nothing for drives on a sprite (8 GB, no GPU) |

`gpt-transcribe` takes `keywords`: the host sends the open document's title
and the titles at the drive's top level, so "Bryan's Days", "Marble" and
"Mashup Studio" come back spelled the way the drive spells them.

## Voice: text to speech

| Option | Quality | Latency | Cost | Verdict |
|---|---|---|---|---|
| Browser `speechSynthesis` | robotic on Windows and Chrome; fair Siri voices on Apple | instant, offline | free | **fallback** for Read aloud on a drive with no OpenAI key; never the default |
| OpenAI `gpt-4o-mini-tts`, voices `marin` / `cedar` (OpenAI's recommended pair) and eleven more, an `instructions` field for tone and pace | good, natural | streams; first audio about 0.3–0.6 s | $12 per 1M audio tokens, about 1.5¢ a minute | **v1** |
| OpenAI `tts-1` | older, flatter | slightly faster | $15 per 1M characters | no |
| `gpt-realtime-2.1` / `gpt-live-1` voices | best, and they can be interrupted mid-word | lowest | per minute or per audio token, far more | v2, with B |
| ElevenLabs | best of the lot | Flash about 75 ms | its own plan | **no**: a new company, a new key and account, every reply's text sent to a third party, for a voice not much better than `marin` |

OpenAI's usage policy asks that a listener be told the voice is AI-generated.
The Voice row in Settings says "Replies are read by an OpenAI voice", and the
person who turned it on is the person listening.

## What is spoken

The written reply and the spoken one are the same words, written to be
heard. A spoken turn's prompt gets one more context line (`runner.js`, beside
the Chat app's):

> They said this aloud, and your reply will be read aloud to them. Start your
> reply at once. Keep it to one to three short sentences that sound right
> spoken: no lists, headings, tables, code, links, file paths or ids. Say what
> you did or found and anything you need from them; the page and the chat
> already show the work, so don't walk through it. A transcription can mishear
> a name: if a word doesn't fit, take the nearest document or term that does.

The work is still shown where it is shown now: the marks on the page, the
progress card in the chat, the end card's track and next steps. The voice
says the sentence and the page shows the rest. Simple progress already draws
a turn so someone can follow it without reading a log; voice leans on that.

The host does not trust the instruction alone. Before speaking, `speakable()`
takes the turn's last `text` and drops fenced blocks (code and `marble-visual`),
markdown marks, tables and bare URLs; turns links into their words and a path
into its file's name; and stops after about 60 words at a sentence end, adding
"The rest is in the chat." A turn that failed says its reason's first
sentence. A turn that asks (Allow or Deny) says "It needs your OK. It's on the
screen.", and the ask is answered by hand: a television in the background
saying "yes" must not approve a command.

Only the last reply is spoken. The texts between tool calls are the agent
thinking aloud in the transcript; reading them out would talk over the work.

## Where voice lives

| Place | v1 | Why |
|---|---|---|
| The chat's composer (drawer, Agents panes, the callout card, the Chat app, the phone sheet) | a drawn microphone in the bar, left of Send, with the tip "Talk" | every conversation already has this bar; a spoken prompt is a prompt, so it starts where typing starts |
| The ⌘J line | phase 2: **hold ⌘J**. A press opens the line as now; still held after 300 ms, it listens into the line; letting go sends | ⌘J already means "ask about this, here": the selection, the caret's block or what is under the pointer. Holding it to say the ask is the same gesture, and the target comes from where you are, which speech alone cannot give. No new key to learn, and nothing about the tap changes |
| A key of its own (⌘⇧Space, bare ⌥ held) | no | ⌥ moves the caret by a word and is reserved on purpose (`agent-callout.js`); a second key for "ask" splits one idea in two |
| The phone | the microphone takes Send's place while the box is empty, as in Messages. Phase 3: after you speak, the sheet folds to a **voice bar** at the foot so the page shows while the agent works | a phone has no ⌘J and no hover; a thumb is at the foot; you want to see the page change |
| On the document | nothing | the page changes and nothing talks (Ask at Anything v5): the agent's marks and the change are the feedback. Voice is in the chat's chrome |

### What it looks like

The composer is one card: the box, then a bar of words. Voice changes what the
box shows, not the layout.

- **At rest**: the microphone sits left of Send, 20 inside a 44 hit box, in
  currentColor, like every icon. Tip: "Talk". It does not move.
- **Listening**: the box shows "Listening" in the label ink and, beside it, a
  2px trace in ink drawn from the microphone's level. The trace moves only
  while there is sound to draw: it is the one moving thing, and it is
  information (you can see it hears you). Send reads Send; Cancel (×) and Esc
  throw the clip away. It stops by itself after 1.2 s of quiet following
  speech, or on Send.
- **Writing it down**: under a second. The words then land in the box, and are
  sent unless you are holding the box (a tap in it before they land keeps them
  there to edit).
- **Your prompt** in the transcript is the words, with "Said aloud" in its meta
  line. The audio is gone.
- **Working**: as today. The progress card, the marks on the page, the
  Island pill.
- **Speaking**: the bar says "Speaking" with the same trace drawn from the
  playback, and the microphone becomes **Stop** (a square). Esc stops it.
  Pressing Talk, or holding ⌘J, stops it and listens: that is barge-in in v1.
- **Read aloud** in a reply's row actions reads any reply, typed or spoken.

No orb, no glowing blob, no full-screen voice view on a desk, no pulse at
rest, no violet: the agent's violet stays the agent's working colour on the
page, and voice is not the agent working. On a phone the voice bar floats over
the page, so it may be glass, one layer, opaque under
`prefers-reduced-transparency`; under `prefers-reduced-motion` the trace is
still and the word carries the state.

Words, all in the drawer's voice: Talk, Listening, Writing it down, Send,
Cancel, Speaking, Stop, Read aloud, Said aloud. Errors say what failed and what
to do:

- "The microphone is blocked for this site. Allow it in the browser's site settings."
- "The microphone needs a secure address. Open the drive at its https name."
- "Didn't catch anything. Try again a little closer."
- "Voice needs an OpenAI key on this drive. Add one in Settings › Voice."
- "OpenAI didn't answer. Try again." (the clip is kept in the tab for one retry)

## Turn-taking

- **v1, push to talk.** A press starts listening; quiet or Send ends it. The
  quiet detector is a few lines over a Web Audio `AnalyserNode` (RMS above a
  floor set from the first 300 ms, then 1.2 s below it), so no model and no
  dependency.
- **While a turn runs**, a spoken prompt goes the way the bar's
  Queue / Steer / Interrupt choice sends the next prompt. The bar starts on
  Queue; a spoken prompt starts on Steer, because talking to someone who is
  working is correcting them, not leaving a note (open question 3). Saying
  "stop" is not a command; Stop is.
- **Phase 2, keep listening.** A switch on the bar: after the reply is spoken,
  the microphone opens again for 8 s, and closes on quiet. Talking over the
  reply stops it (barge-in by voice), with the browser's echo cancellation on
  and a higher floor while it speaks; headphones make this reliable, a laptop
  speaker less so, which is why it is a switch.
- **Phase 2, a word while it works.** If a spoken turn runs past 8 s, the voice
  says the progress card's sentence once ("Reading Bryan's Days."), so silence
  is not mistaken for nothing happening.
- **v2, the live voice.** The model decides turns itself (full duplex).
- **Never a wake word.** Nothing listens until a press.

## Both providers

- **Talking to Claude**: a chat on Claude, spoken to. OpenAI's ears and voice,
  Claude's words. The Settings row says so.
- **Talking to Codex** (the drive's ChatGPT-family agent): the same, on Codex.
- **Without an OpenAI key**: the microphone is not drawn; Read aloud uses the
  device's voice; Settings › Voice offers the key field (the same `openai` key
  Codex uses, checked the same way). Dictation through the phone's keyboard
  still works, as now.
- **v2, a voice that is GPT**: `gpt-live-1` holds the talk, and its client
  delegation sends the drive's agent a turn in this conversation. It can talk
  while the agent works and say what it did when it ends.

## v2: a voice in front

- The browser opens a WebRTC session to OpenAI with an ephemeral client secret
  the host mints for it (`POST /v1/realtime/client_secrets` or GPT-Live's
  equivalent); the key never leaves the host, and the secret lives a minute.
  The page then talks to a third-party origin, which no part of the runtime
  does today: say so in the spec of v2 and keep it to the owner's own pages.
  The alternative, the host relaying audio on a WebSocket, needs a WebSocket
  server the host does not have (Node 22 has the client, not the server).
- The voice model gets the drive's state as a short system note (the open
  document, the chat's last turn) and is told to hand over anything about a
  document: it does not read pages itself.
- Delegation is `POST /agent/conversations/:id/turns` with `context.spoken`,
  the same as v1. The progress card's sentence is fed back as it changes, so
  the voice can say how it is going; the turn's last reply goes back when it
  ends. Interrupting the voice does not stop the turn; "Stop" on the bar does.
- Both sides' words land in the one transcript: your words as prompts (Said
  aloud), the voice's own small talk as a quiet line, the agent's replies as
  now.

## Security and privacy

- **The microphone** is asked for on the first press, by the browser, per
  origin. It is never opened on load, never while the tab is hidden (leaving
  the tab cancels listening), and every track is stopped the moment listening
  ends, so the browser's recording light goes out.
- **Audio is not kept.** The clip lives in the tab and in the host's memory for
  one request, and is forwarded to OpenAI. It is not written to `.marble/`, the
  drive, a backup, the op log or the transcript. Spoken replies are streamed
  through and not cached. Keeping recordings is a later switch, off, if it is
  ever asked for.
- **Keys stay on the host.** The browser sends audio to its own host and gets
  text and audio back; it never sees the OpenAI key. v2's ephemeral secrets are
  minted per session and expire.
- **The gate.** The voice routes are `/agent/*`: behind the drive's passphrase,
  POSTs only from the drive's own origin (`sameOrigin`), refused on an ungated
  host not addressed as localhost, and unreachable from a share link (a link
  cannot run agents, so it cannot talk to one).
- **Spend.** A clip is capped at 2 minutes and 4 MB; a spoken reply at 2,000
  characters; Settings › Usage shows minutes heard and spoken this month.
- **Testers.** On drives whose agents run on the owner's login, voice is off
  unless that drive has its own OpenAI key: the owner should not pay for a
  friend's voice by accident.
- **A spoken prompt is a prompt.** The same rules, asks and undo apply; no new
  permission comes with a voice, and asks are not answered by voice.

## Not in v1

- Holding ⌘J, keep listening, barge-in by voice, a word while it works
  (phase 2).
- The phone's voice bar, AirPods and lock-screen controls through
  `navigator.mediaSession` (phase 3).
- The live voice in front (v2).
- Transcribing on the home machine; streaming partial words; keeping audio.

## Open questions

1. Will you put an OpenAI API key on the drive for voice (about 2¢ a minute
   of talk)? Codex may be on your ChatGPT login, which cannot pay for audio.
2. Should what you say send itself when you stop, or wait in the box for a
   look?
3. Speaking while a turn runs: steer it (proposed here), or queue like typing?
4. Hear replies only when you spoke, or always?
5. Which voice: `marin` or `cedar`, and how fast?
6. On long work, one spoken line after 8 s, or quiet until it ends?
7. Is the phone-call feel worth $0.05 a minute and a second mind (v2)?
8. Private transcription on the PC: does it have an NVIDIA GPU WSL2 can use,
   and is keeping audio in the house worth a 1.5 GB model?
9. Friends' drives: off unless they bring their own key, as above?
