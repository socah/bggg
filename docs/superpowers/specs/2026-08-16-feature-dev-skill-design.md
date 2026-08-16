# feature-dev-skill: production feature development with a Plane paper trail

**Status:** Approved for planning
**Date:** 2026-08-16

## Problem

The repo currently has one Claude skill, `boardgame-skill`, which enforces a
learning-first workflow (teach → predict → generate → checkpoint → advance)
for every task. That's the right mode while the user is building up
understanding of a technology for the first time, but it's the wrong mode once
a feature has moved past "learn how this works" into "ship this to
production": production work needs a real paper trail (what was decided, what
was built, what's left) rather than learning notes, and it needs to move at
implementation speed rather than pausing for checkpoints on every concept.

We need a second skill, `feature-dev-skill`, for production feature
development, plus a way to toggle between the two modes with a `make`
command so only one skill is active — and claiming to apply — at a time.

## Goals

- A `feature-dev-skill` that drives a feature from idea → spec → plan →
  implementation → done, using the existing `superpowers` plugin skills for
  each of those stages rather than reinventing them.
- A paper trail in Plane (project `BGGG`, id
  `09998445-85da-4435-aba9-dcdc70662758`) for every feature: a work item,
  a linked Page holding the detailed spec, child work items as subtasks, and
  state transitions/comments as progress happens.
- A `make` command to toggle which skill is active, so `boardgame-skill` and
  `feature-dev-skill` don't both try to claim the same task.

## Non-goals

- Rebuilding TDD, code review, or plan-execution mechanics — those are the
  existing `superpowers:test-driven-development`,
  `superpowers:requesting-code-review`, `superpowers:executing-plans`, and
  `superpowers:subagent-driven-development` skills. `feature-dev-skill`
  orchestrates and recommends them; it doesn't reimplement them.
- A new local progress-tracking file for feature-dev mode. `boardgame-skill`
  uses `progress.json` because there's no external system of record; Plane
  itself is the system of record for feature-dev mode, so "where did I leave
  off" is answered by querying Plane, not by duplicating state locally.
- Hard-blocking on process steps (code review, verification) being skipped.
  The skill recommends the superpowers quality gates at the right moments but
  does not refuse to proceed if the user wants to skip one.

## Architecture

Two sibling skills under `.claude/skills/`, gated by one shared mode file so
only one is active at a time:

- **`.claude/skills/active-mode.txt`** — contains exactly `learning` or
  `feature-dev`. Missing or malformed → treated as `learning` (safe default,
  preserves current behavior) and the file is rewritten to a valid value.
- **Root `Makefile`** (new — none exists in the repo today) with targets:
  - `make mode-learning` — writes `learning` to `active-mode.txt`.
  - `make mode-feature-dev` — writes `feature-dev` to `active-mode.txt`.
  - `make mode-status` — prints the current mode.
- **`boardgame-skill/SKILL.md`** gets a new Step 0 (before its existing "On
  Every Session Start" section): read `active-mode.txt`; if it says
  `feature-dev`, stop and tell the user `feature-dev-skill` is active instead
  (don't proceed with the learning loop). Its frontmatter `description` is
  narrowed from "Use this skill for ALL tasks in this repository" to
  something conditioned on learning-mode being active.
- **`.claude/skills/feature-dev-skill/SKILL.md`** (new) — the mirror image:
  Step 0 checks `active-mode.txt`; if it says `learning`, defer to
  `boardgame-skill` instead.

## `feature-dev-skill` workflow

**On session start (once active):** query Plane for open work items in
project `BGGG` relevant to this repo and report them in one sentence —
mirrors how `boardgame-skill` reports roadmap position, but the source of
truth is Plane, not a local file.

**Starting a new feature:**

1. **Brainstorm** — invoke `superpowers:brainstorming` if the feature hasn't
   already been scoped (skip if the user arrives with an approved design).
2. **Create the Plane paper trail:**
   - Create a work item in project `BGGG` for the feature (title + short
     description).
   - Write the detailed spec to
     `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (git-tracked, per
     the existing `superpowers:brainstorming` convention) **and** as a Plane
     Page linked to the work item, so the full spec is visible to
     non-git stakeholders too. (The exact linking mechanism — `page` tool
     fields vs. `workitem_link` vs. a reference pasted into the work item
     description — needs to be confirmed against the live `mcp__plane__page`
     and `mcp__plane__workitem_link` tool schemas during planning, since it
     wasn't verified during design.)
3. **Plan** — invoke `superpowers:writing-plans`. Each step/task in the
   resulting plan becomes a child work item (subtask, via `parent`) under the
   feature work item, created in Plane's default "Todo" state.
4. **Implement** — the skill chooses per plan shape: independent,
   parallelizable tasks → `superpowers:subagent-driven-development`;
   sequential work needing human review checkpoints →
   `superpowers:executing-plans`. As each subtask starts/finishes, update its
   Plane state (Todo → In Progress → Done) and add a short comment describing
   what was done — this comment trail *is* the running progress record.
5. **Recommend, don't force**, the relevant superpowers quality gates at the
   right moments: TDD during implementation, `verification-before-completion`
   before claiming anything is done, `requesting-code-review` before merge,
   `finishing-a-development-branch` to close out.
6. **Closing a feature** — once every subtask is Done, transition the parent
   work item to Done and post a closing comment summarizing what shipped.

**Small fixes:** the skill uses judgment — a trivial one-line change doesn't
need a Plane work item at all. Paper-trail ceremony is for things that
qualify as a "feature," matching the skill's name and purpose.

## Edge cases

- **Plane MCP unreachable:** don't block local work. Warn once, continue with
  git/plan work locally, and note the missed sync (e.g. in the plan or a
  commit note) so it can be reconciled once Plane is reachable again — no
  silent loss of paper trail, no blocking either.
- **Mode file missing/malformed:** default to `learning`, self-heal by
  writing a valid value.
- **Multi-session features:** answered by querying Plane's open
  work-items/subtasks under project `BGGG`, not a new local tracking file —
  avoids a second source of truth that could drift from Plane.

## Testing / validation

This is a prompt/workflow skill, not executable application code, so
validation is:

- Toggle `active-mode.txt` via `make mode-feature-dev` / `make mode-learning`
  and confirm each skill self-defers correctly in the other mode.
- Walk one small real feature end-to-end and confirm a work item + linked
  Page actually appear in Plane project `BGGG`, with subtasks transitioning
  state as implementation proceeds.
- Run the new skill through `superpowers:writing-skills`' own verification
  checklist before considering it done.
