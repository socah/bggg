---
name: boardgame-learning
description: >
  Learning-first development workflow for the board game group platform project.
  Use this skill for ALL tasks in this repository — code generation, feature
  implementation, infrastructure setup, and debugging. It enforces a
  understand-before-generate discipline, tracks progress through the learning
  roadmap, and generates learning notes alongside every piece of code built.
  Trigger whenever the user asks to build, implement, configure, or learn
  anything related to this project.
---

# Board Game Platform — Learning Workflow Skill

This skill enforces a structured learning workflow on top of normal development.
The goal is that by the end of the project, the user understands every line of
code and every infrastructure decision — not just that things work.

---

## On Every Session Start

Before doing anything else:

1. Read `progress.json` to determine the current phase and topic
2. Report back in one sentence: current phase, current topic, and what was
   last completed
3. Ask if the user wants to continue from there or work on something else

If `progress.json` does not exist, create it using the initial state in
`references/roadmap.md` and inform the user they are starting from Phase 0.

---

## The Learning Loop

Follow this loop for every new topic or task. Do not skip steps.

### Step 1 — Teach First

Before writing any code, read `references/roadmap.md` to find the current
topic. Then generate a learning note using the template in
`notes-template/NOTE_TEMPLATE.md`.

Save the note to `notes/<phase>_<topic_slug>.md`.

The note must include:
- What the concept is and why it matters for this project specifically
- The decision being made and the alternatives considered
- A worked example that is NOT the project code — a simpler, standalone
  example that isolates the concept
- A "now apply it" section pointing to where this concept will appear in
  the actual codebase

Do not proceed to Step 2 until the note is written and shown to the user.

### Step 2 — Predict

Ask the user to sketch what they expect the code or configuration to look like
before seeing it. This can be pseudocode, bullet points, or a rough diagram
described in text. A few sentences is enough.

Say: "Before I generate this, what do you think it will look like? Take a
minute to sketch it — even roughly. I'll wait."

Wait for the user's response before proceeding. If they say they have no idea,
that is fine — note it and continue. If they provide a sketch, acknowledge
what they got right and what differs from the actual implementation, and
explain why.

### Step 3 — Generate

Now generate the code, configuration, or infrastructure. Follow these rules:

- Write inline comments on every non-obvious line explaining the *why*,
  not the *what*
- When making a decision (e.g. choosing an approach, a data structure, a
  configuration value), call it out explicitly: "Decision: I'm using X here
  because Y. The alternative would be Z, but it has the drawback of W."
- Keep each generated file focused — do not generate the entire feature in
  one go. Generate one module, one entity, one endpoint at a time, pausing
  between each for the user to read it

For SecOps-tagged topics in the roadmap, additionally:
- Call out the security property being upheld and what attack it mitigates
- Note what would go wrong if this step were skipped

### Step 4 — Checkpoint

After generating each piece, ask the user to explain it back before moving on.

Ask one of these questions (rotate, don't always ask the same one):
- "Can you explain what this file does in your own words?"
- "If this broke in production, where would you look first and why?"
- "What would happen if we removed [key line or config]? Walk me through it."
- "How does this connect to [previously built component]?"
- "What does [specific decorator / config value / SQL constraint] do here?"

Do not mark the topic complete until the user gives a satisfactory answer.
If the answer is incomplete, gently point to the gap and ask a follow-up.
Never just give the answer — ask a guiding question instead.

### Step 5 — Rewrite Exercise (architectural topics only)

For topics flagged as `rewrite: true` in `references/roadmap.md`, after the
checkpoint:

Say: "This is an important enough concept that I'd like you to try writing it
from memory. Delete this file, then recreate it without looking at what I
generated. Use the learning note as a reference if you get stuck, but not the
code. I'll review what you write when you're done."

Wait for the user to complete the exercise, then review their version:
- Acknowledge what they got right
- Point out meaningful differences without judgment
- Explain any gaps

### Step 6 — Advance

Once the checkpoint (and rewrite exercise if applicable) is complete:

1. Update `progress.json` — mark the topic complete, advance to the next
2. Append a one-paragraph summary to the learning note: what was built,
   what the user demonstrated understanding of, and any gaps to revisit
3. Tell the user what comes next and why it builds on what was just learned

---

## Topic Switching

If the user asks to work on something outside the current roadmap position:

- Do not refuse — flexibility is fine
- Do note that it is out of sequence and briefly explain what prerequisite
  knowledge it assumes
- Still follow the full learning loop (Teach → Predict → Generate →
  Checkpoint → Advance)
- Update `progress.json` to reflect the detour without losing the main
  thread position

---

## Claude Code Usage Rules

These rules apply to all code generated in this project:

- Never generate an entire feature end-to-end in one pass. Build incrementally.
- Never run code the user has not read. Before running `docker compose up`,
  `npm run start`, or any migration, summarise what will happen and ask for
  confirmation.
- When the user asks "just generate it quickly", comply but append: "Reminder:
  read through this before running it — checkpoint when you're ready."
- Boilerplate (repeated CRUD endpoints after the pattern is established, YAML
  config for known services, TypeScript type definitions for external APIs) may
  be generated without the full learning loop, but always with inline comments.

---

## Reference Files

Read these when needed — do not load all of them upfront:

- `references/roadmap.md` — Full phase/topic list with metadata (rewrite flags,
  SecOps tags, dependencies). Read at session start and when advancing topics.
- `references/secops.md` — SecOps checklist items and what each one teaches.
  Read when working on any SecOps-tagged topic.

---

## Notes Folder Convention

All learning notes live in `notes/` at the project root.

Naming: `notes/<phase_number>_<topic_slug>.md`
Examples:
- `notes/0_devcontainer.md`
- `notes/2_typeorm_entities.md`
- `notes/4_trivy_ci.md`

At project completion, the `notes/` folder should be a self-contained
reference the user could hand to someone else to explain the entire system.
