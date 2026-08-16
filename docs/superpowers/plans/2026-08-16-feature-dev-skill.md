# feature-dev-skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `feature-dev-skill` for production feature work that keeps a paper trail in Plane (project `BGGG`), plus a `make`-controlled mode toggle so it and the existing `boardgame-skill` never both claim the same task.

**Architecture:** A single text file (`.claude/skills/active-mode.txt`) holds the active mode (`learning` or `feature-dev`). A new root `Makefile` writes to it. Both `boardgame-skill/SKILL.md` and the new `feature-dev-skill/SKILL.md` read it as their first step and self-defer if it's not their mode. `feature-dev-skill` drives features through the existing superpowers skills (brainstorming, writing-plans, subagent-driven-development/executing-plans) and mirrors progress into Plane via `workitem` (feature + subtask work items, state transitions, comments) and `page` (linked spec).

**Tech Stack:** Markdown skill files (Claude Code skill format), GNU Make, Plane MCP tools (`mcp__plane__workitem`, `mcp__plane__page`, `mcp__plane__state`, `mcp__plane__project`).

**Spec:** `docs/superpowers/specs/2026-08-16-feature-dev-skill-design.md`

## Global Constraints

- `active-mode.txt` contains exactly one bare word on its own line: `learning` or `feature-dev`. No other values are valid.
- Plane project for the paper trail: name `bggg`, identifier `BGGG`, id `09998445-85da-4435-aba9-dcdc70662758` — used verbatim in `feature-dev-skill/SKILL.md`.
- Linking a spec page to a work item uses `mcp__plane__page` (`create`, then `attach_to_workitem`) — **not** `mcp__plane__workitem_link` (that tool is for external URLs only).
- Subtasks are work items created with `mcp__plane__workitem create` passing `parent=<feature workitem id>` — there is no separate "subtask" object in Plane.
- Work item states are per-project and must be resolved at runtime via `mcp__plane__state list` (project_id) — never hardcode a state id, since state ids are environment-specific.
- Missing/malformed `active-mode.txt` must be treated as `learning` and the file rewritten to a valid value — never error out.
- Neither skill hard-blocks on the other superpowers quality-gate skills (TDD, verification-before-completion, requesting-code-review, finishing-a-development-branch) — those are recommended at the right moments, never enforced.

---

### Task 1: Mode-toggle file and Makefile

**Files:**
- Create: `.claude/skills/active-mode.txt`
- Create: `Makefile` (repo root)

**Interfaces:**
- Produces: `.claude/skills/active-mode.txt` — single bare word, `learning` or `feature-dev`.
- Produces: `Makefile` targets `mode-learning`, `mode-feature-dev`, `mode-status` — `mode-status` prints the current mode to stdout.

- [ ] **Step 1: Create the initial mode file**

Create `.claude/skills/active-mode.txt` with exactly this content (one line, no trailing blank line beyond the newline):

```
learning
```

- [ ] **Step 2: Write the Makefile**

Create `Makefile` at the repo root:

```makefile
MODE_FILE := .claude/skills/active-mode.txt

.PHONY: mode-learning mode-feature-dev mode-status

mode-learning:
	@echo learning > $(MODE_FILE)
	@echo "Active mode set to: learning"

mode-feature-dev:
	@echo feature-dev > $(MODE_FILE)
	@echo "Active mode set to: feature-dev"

mode-status:
	@echo "Active mode: $$(cat $(MODE_FILE) 2>/dev/null || echo 'learning (default, no mode file present)')"
```

- [ ] **Step 3: Verify the targets behave correctly**

Run:

```bash
make mode-feature-dev
cat .claude/skills/active-mode.txt
make mode-status
make mode-learning
cat .claude/skills/active-mode.txt
make mode-status
```

Expected output, in order:
```
Active mode set to: feature-dev
feature-dev
Active mode: feature-dev
Active mode set to: learning
learning
Active mode: learning
```

- [ ] **Step 4: Verify the missing-file fallback**

Run:

```bash
mv .claude/skills/active-mode.txt /tmp/active-mode.txt.bak
make mode-status
mv /tmp/active-mode.txt.bak .claude/skills/active-mode.txt
```

Expected: `Active mode: learning (default, no mode file present)`, and the file is restored to `learning` afterward (confirm with `cat .claude/skills/active-mode.txt`).

- [ ] **Step 5: Commit**

```bash
git add Makefile .claude/skills/active-mode.txt
git commit -m "Add mode-toggle file and Makefile for learning/feature-dev skill switching"
```

---

### Task 2: Gate boardgame-skill on active-mode.txt

**Files:**
- Modify: `.claude/skills/boardgame-skill/SKILL.md`

**Interfaces:**
- Consumes: `.claude/skills/active-mode.txt` (Task 1) — read relative to repo root.
- Produces: a "Step 0" pattern (read mode file, defer if not matching) that Task 3's `feature-dev-skill/SKILL.md` mirrors in reverse.

- [ ] **Step 1: Narrow the frontmatter description**

In `.claude/skills/boardgame-skill/SKILL.md`, replace the frontmatter `description` field:

```
description: >
  Learning-first development workflow for the board game group platform project.
  Use this skill for ALL tasks in this repository — code generation, feature
  implementation, infrastructure setup, and debugging. It enforces a
  understand-before-generate discipline, tracks progress through the learning
  roadmap, and generates learning notes alongside every piece of code built.
  Trigger whenever the user asks to build, implement, configure, or learn
  anything related to this project.
```

with:

```
description: >
  Learning-first development workflow for the board game group platform project,
  active only when .claude/skills/active-mode.txt is set to "learning" (the
  default). Use this skill for tasks in this repository when in learning mode —
  code generation, feature implementation, infrastructure setup, and debugging.
  It enforces a understand-before-generate discipline, tracks progress through
  the learning roadmap, and generates learning notes alongside every piece of
  code built. When active-mode.txt is set to "feature-dev", defer to
  feature-dev-skill instead. Trigger whenever the user asks to build, implement,
  configure, or learn anything related to this project while in learning mode.
```

- [ ] **Step 2: Add the Step 0 mode gate**

In the same file, immediately before the `## On Every Session Start` heading, insert:

```markdown
## Step 0 — Check Active Mode

Before anything else, read `.claude/skills/active-mode.txt` (relative to the
repo root). If the file is missing or its content is anything other than
`feature-dev`, treat it as `learning` mode and proceed normally below. If it
is `feature-dev`, stop here: tell the user "feature-dev-skill is active
(active-mode.txt is set to feature-dev) — use that skill instead, or run
`make mode-learning` to switch back to learning mode." Do not proceed with
the learning loop while in feature-dev mode.

---
```

- [ ] **Step 3: Verify the edit**

Run:

```bash
grep -n "Step 0 — Check Active Mode" .claude/skills/boardgame-skill/SKILL.md
grep -n 'active only when .claude/skills/active-mode.txt' .claude/skills/boardgame-skill/SKILL.md
```

Expected: both `grep` commands print one matching line each (non-empty output, exit code 0).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/boardgame-skill/SKILL.md
git commit -m "Gate boardgame-skill on active-mode.txt, deferring to feature-dev-skill"
```

---

### Task 3: Create feature-dev-skill

**Files:**
- Create: `.claude/skills/feature-dev-skill/SKILL.md`

**Interfaces:**
- Consumes: `.claude/skills/active-mode.txt` (Task 1); mirrors the Step-0 gate pattern from Task 2 in reverse.
- Consumes: Plane MCP tools — `mcp__plane__workitem` (`create`/`update`/`list`/`retrieve` with `parent`, `state`), `mcp__plane__page` (`create`/`attach_to_workitem`), `mcp__plane__state` (`list`), `mcp__plane__project` (id `09998445-85da-4435-aba9-dcdc70662758`, identifier `BGGG`).
- Produces: the second half of the mode-gated skill pair — no later task depends on this one.

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/feature-dev-skill/SKILL.md`:

```markdown
---
name: feature-dev-skill
description: >
  Production feature development workflow with a Plane paper trail, active
  only when .claude/skills/active-mode.txt is set to "feature-dev". Drives a
  feature from spec through implementation to done, creating a Plane work
  item (project BGGG) and linked spec Page, breaking the plan into Plane
  subtasks, and updating their state/comments as work progresses. When
  active-mode.txt is set to "learning" (the default), defer to
  boardgame-skill instead. Trigger whenever the user asks to build or ship a
  production feature in this repository while in feature-dev mode.
---

# Production Feature Development — Plane Paper Trail Skill

This skill drives a feature from idea to done using the existing
`superpowers` plugin skills for each stage, while keeping a paper trail in
Plane (project `bggg`, identifier `BGGG`, id
`09998445-85da-4435-aba9-dcdc70662758`) so both the plan of record and its
progress are visible to non-git stakeholders.

---

## Step 0 — Check Active Mode

Before anything else, read `.claude/skills/active-mode.txt` (relative to the
repo root). If the file is missing or its content is anything other than
`feature-dev`, stop here: tell the user "boardgame-skill is active
(active-mode.txt is set to learning, or the file is missing) — use that
skill instead, or run `make mode-feature-dev` to switch to feature-dev
mode." Do not proceed with the rest of this skill while in learning mode.

If the file says `feature-dev`, continue below.

---

## On Every Session Start

Query Plane for open feature work in this project:

1. Call `mcp__plane__workitem list` with `project_id=09998445-85da-4435-aba9-dcdc70662758`
   and `pql='stateGroup IN openStates()'`.
2. Report back in one sentence: how many open work items exist and the
   name of the most recently updated one.
3. Ask if the user wants to continue that one or start something new.

There is no local progress file for this mode — Plane itself is the system
of record for "where did I leave off."

---

## Starting a New Feature

### Step 1 — Brainstorm

If the feature has not already been scoped and approved, invoke
`superpowers:brainstorming` first. Skip this step only if the user arrives
with an already-approved design.

### Step 2 — Create the Plane paper trail

1. Create the feature's work item:
   `mcp__plane__workitem create` with `project_id=09998445-85da-4435-aba9-dcdc70662758`,
   `name=<feature title>`, `description_html=<short summary>`.
2. Write the detailed spec to
   `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (git-tracked, same
   convention `superpowers:brainstorming` already uses).
3. Mirror that spec into Plane as a linked Page:
   - `mcp__plane__page create` with `project_id=09998445-85da-4435-aba9-dcdc70662758`,
     `name=<feature title>`, `description_html=<spec content rendered as HTML>`.
   - `mcp__plane__page attach_to_workitem` with `project_id`, the feature's
     `workitem_id`, and the new `page_id`.

### Step 3 — Plan

Invoke `superpowers:writing-plans` to turn the spec into a step-by-step
plan. For each task in the resulting plan, create a child work item:
`mcp__plane__workitem create` with `project_id=09998445-85da-4435-aba9-dcdc70662758`,
`name=<task title>`, `parent=<feature workitem id>`. Leave `state` unset so
it lands in the project's default (Todo-equivalent) state.

### Step 4 — Implement

Choose the execution approach per the plan's shape:
- Independent, parallelizable tasks → `superpowers:subagent-driven-development`.
- Sequential work that benefits from human review checkpoints →
  `superpowers:executing-plans`.

As each subtask starts and finishes:
1. Resolve the project's state ids once via `mcp__plane__state list`
   (`project_id=09998445-85da-4435-aba9-dcdc70662758`) and match by `group`
   (`unstarted`, `started`, `completed`).
2. `mcp__plane__workitem update` the subtask's `state` to the matching id
   as it moves Todo → In Progress → Done.
3. Add a short comment on the subtask (`mcp__plane__workitem_comment`)
   describing what was done — this comment trail is the running progress
   record, not a local file.

### Step 5 — Recommend quality gates (do not force)

At the right moments, point the user to (but do not block on):
- `superpowers:test-driven-development` during implementation.
- `superpowers:verification-before-completion` before claiming anything is done.
- `superpowers:requesting-code-review` before merge.
- `superpowers:finishing-a-development-branch` to close out.

### Step 6 — Close the feature

Once every subtask work item is in a `completed` state, update the parent
feature work item's state to `completed` and add a closing comment
summarizing what shipped.

---

## Small Fixes

Trivial one-line changes don't need a Plane work item at all — use
judgment. Paper-trail ceremony is for things that qualify as a "feature,"
matching this skill's purpose.

---

## Handling Plane Being Unreachable

If any `mcp__plane__*` call fails, don't block local work: warn the user
once, continue with the git/plan work locally, and note the missed sync
(e.g. in the plan file or a commit message) so it can be reconciled once
Plane is reachable again.
```

- [ ] **Step 2: Verify the file structure**

Run:

```bash
grep -n "^name: feature-dev-skill" .claude/skills/feature-dev-skill/SKILL.md
grep -n "Step 0 — Check Active Mode" .claude/skills/feature-dev-skill/SKILL.md
grep -n "09998445-85da-4435-aba9-dcdc70662758" .claude/skills/feature-dev-skill/SKILL.md
grep -c "^##" .claude/skills/feature-dev-skill/SKILL.md
```

Expected: the first three `grep` commands each print at least one matching
line (exit code 0); the `grep -c` count is at least 5 (one per major
section: Step 0, On Every Session Start, Starting a New Feature, Small
Fixes, Handling Plane Being Unreachable, plus the `###` sub-steps don't
count toward this `##`-only count).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/feature-dev-skill/SKILL.md
git commit -m "Add feature-dev-skill: production feature workflow with Plane paper trail"
```

---

### Task 4: End-to-end validation

**Files:** none created or modified — this task only runs verification.

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Verify mode gating text is consistent both directions**

Run:

```bash
grep -n "defer to feature-dev-skill" .claude/skills/boardgame-skill/SKILL.md
grep -n "defer to boardgame-skill" .claude/skills/feature-dev-skill/SKILL.md
```

Expected: both print one matching line — confirms each skill's frontmatter
description names the other as the fallback.

- [ ] **Step 2: Live smoke-test the Plane calls the skill documents**

Using the Plane MCP tools directly (not by invoking the skill), run this
sequence and confirm each call succeeds:

1. `mcp__plane__workitem create` with `project_id=09998445-85da-4435-aba9-dcdc70662758`,
   `name="feature-dev-skill smoke test"` — confirm it returns a `workitem_id`.
2. `mcp__plane__workitem create` with the same `project_id`, `name="smoke test subtask"`,
   `parent=<workitem_id from step 1>` — confirm it returns a subtask id and
   `mcp__plane__workitem retrieve` on the parent shows the subtask as a child.
3. `mcp__plane__page create` with the same `project_id`, `name="smoke test page"`,
   `description_html="<p>smoke test</p>"` — confirm it returns a `page_id`.
4. `mcp__plane__page attach_to_workitem` with `project_id`, the parent
   `workitem_id`, and `page_id` — confirm `mcp__plane__page list_workitem_pages`
   (same `project_id`/`workitem_id`) now lists it.
5. `mcp__plane__state list` with the same `project_id` — confirm at least
   one state has `group="completed"`.
6. `mcp__plane__workitem update` both the subtask and parent `state` to that
   completed state id — confirm via `mcp__plane__workitem retrieve` on each.
7. Clean up: `mcp__plane__page detach_from_workitem` (using the
   `workitem_page_id` from `list_workitem_pages` in step 4, not the `page_id`
   itself), then `mcp__plane__workitem delete` the subtask, then the parent.
   Note: the `page` tool has no `delete` action, so the smoke-test page
   itself will remain in Plane's page list after this — a harmless leftover,
   not a bug in this plan.

- [ ] **Step 3: Toggle test in a real session**

Run `make mode-feature-dev`, start a fresh Claude Code session in this
repo, and confirm `feature-dev-skill` self-identifies as active (not
`boardgame-skill`). Then run `make mode-learning` and confirm the reverse.
Restore whichever mode the user actually wants to work in afterward.

- [ ] **Step 4: Run the writing-skills verification checklist**

Invoke `superpowers:writing-skills` and follow its own verification
checklist against `.claude/skills/feature-dev-skill/SKILL.md` before
considering this plan done. Fix anything it flags.
