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
