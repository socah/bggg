---
name: feature-dev-skill
description: >
  Use when the user asks to build or ship a production feature in this
  repository while .claude/skills/active-mode.txt is set to "feature-dev" —
  keeps a Plane paper trail (project BGGG) instead of the learning workflow.
  When active-mode.txt is set to "learning" (the default) or is missing,
  defer to boardgame-skill instead.
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
repo root). Compare its content, trimmed of surrounding whitespace, to
`feature-dev`. If the file is missing or its (trimmed) content is anything
other than `feature-dev`, stop here: tell the user "boardgame-skill is active
(active-mode.txt is set to learning, or the file is missing) — use that
skill instead, or run `make mode-feature-dev` to switch to feature-dev
mode." Do not proceed with the rest of this skill while in learning mode.

If the file says `feature-dev`, continue below.

---

## Quick Reference

| Stage | Key MCP call(s) | Notes |
|---|---|---|
| Gate | read `active-mode.txt` | Must equal `feature-dev`, else defer |
| Session start | `workitem list` (`pql='stateGroup IN openStates()'`) | Plane is the progress record, not a local file |
| New feature | `workitem create` (full spec inlined), `page create`/`attach_to_workitem` for the affected reference doc(s) | Work item description carries the spec; Pages are topic reference docs, not per-feature mirrors |
| Plan | `workitem create` (`parent=<feature id>`) per task | Leave `state` unset (default Todo) |
| Implement | `state list` once, then `workitem update` (`state=<id>`) | Resolve state ids by `group`, not by name |
| Close | `workitem update` parent `state` to `completed` | Only after every subtask is `completed` or `cancelled` |

**Terminology:** a **spec** (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`)
is a dated decision record for one scoped change — Problem/Goals/Non-goals/
Approach/Risks. It's closer to a design doc/tech spec than a PRD (a PRD
wouldn't include the Approach section), and the term is inherited from
`superpowers:brainstorming`'s own convention, not renamed here. A
**reference doc** (`docs/reference/<topic>.md`, mirrored to one Plane Page
per topic) is different: it describes a subsystem's *current* behavior,
has no date in its name, and gets updated by whichever feature next
touches that subsystem — it is never created fresh per-feature.

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

1. Write the detailed spec to
   `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (git-tracked, dated,
   same convention `superpowers:brainstorming` already uses — this is the
   historical decision record, one file per change, never edited after the
   fact).
2. Create the feature's work item with the **spec's full content inlined**,
   not a short summary: `mcp__plane__workitem create` with
   `project_id=09998445-85da-4435-aba9-dcdc70662758`, `name=<feature title>`,
   `description_html=<Problem/Goals/Non-goals/Approach/Risks rendered as HTML>`.
   Anyone reading the work item in Plane should get the real reasoning
   without clicking through to git.
3. Identify which reference doc(s) this feature touches (check
   `docs/reference/*.md` in git, and/or `mcp__plane__page list` for an
   existing Page by that topic name — a repo can accumulate several, e.g.
   "Authentication & Keycloak", "Deployment & Infrastructure"). For each:
   - **If one exists:** update the git file in place (normal edit), then
     mirror it to Plane — there is no page `update` action, so: `page create`
     with the *same name* and the new full content, `attach_to_workitem` the
     new page to this feature's work item, then for every work item the
     *stale* version was attached to (`page list_workitem_pages` on the old
     `page_id` — actually query via the work item(s) you know referenced it),
     `page detach_from_workitem` it. The stale page object itself can't be
     deleted via this API; it's just orphaned once nothing points to it.
   - **If none exists yet:** create `docs/reference/<topic>.md` (no date in
     the filename — it's living, not historical) and a matching Plane Page,
     `attach_to_workitem` to this feature.
   - Verify every attach: `mcp__plane__page list_workitem_pages` with
     `project_id` and `workitem_id`, confirm the intended `page_id` appears
     and no stale one remains. `attach_to_workitem` returning success is not
     sufficient confirmation — check the list.

**`description_html` / `comment_html` format:** these fields take literal
HTML markup — `<p>...</p>`, `<h2>...</h2>`, `<ul><li>...</li></ul>` — as the
actual string content, not HTML-entity-escaped text. Passing
`&lt;p&gt;...&lt;/p&gt;` (escaped entities) instead of `<p>...</p>` (real
tags) renders as literal visible `<p>` text in Plane's UI instead of a
formatted paragraph. This applies everywhere this skill calls `workitem
create/update`, `page create`, or `workitem_comment create` with an
`_html` field.

### Step 3 — Plan

Invoke `superpowers:writing-plans` to turn the spec into a step-by-step
plan. For each task in the resulting plan, create a child work item:
`mcp__plane__workitem create` with `project_id=09998445-85da-4435-aba9-dcdc70662758`,
`name=<task title>`, `parent=<feature workitem id>`. Leave `state` unset so
it lands in the project's default (Todo-equivalent) state.

**Prefer tracer bullets for genuinely new functionality.** When the feature
adds a *new* path through the system (a new route, a new integration, a new
service boundary), order the plan's tasks so the first one is a thin, real,
non-throwaway slice through every layer that path touches — verified live
(a real request through the real stack), not mocked — before fanning out to
remaining breadth/edge cases. The goal is fast, real signal on whether the
architecture holds together, the same way this repo's Keycloak login-gate
work only found its real bugs (rewrite-precedence order, `signin/:provider`
being unsupported, `KC_HOSTNAME` missing the proxy path) by pushing curl all
the way through the live stack instead of trusting each layer in isolation.
This does NOT apply to bugfixes with an already-diagnosed root cause in
already-built functionality — those are scoped fixes, not tracer bullets;
don't force the framing where it doesn't fit.

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
3. Add a short comment on the subtask describing what was done via
   `mcp__plane__workitem_comment` with action `create`, `project_id`,
   `workitem_id=<subtask id>`, and `comment_html=<progress note as HTML>` —
   this comment trail is the running progress record, not a local file.

### Step 5 — Recommend quality gates (do not force)

At the right moments, point the user to (but do not block on):
- `superpowers:test-driven-development` during implementation.
- `superpowers:verification-before-completion` before claiming anything is done.
- `superpowers:requesting-code-review` before merge.
- `superpowers:finishing-a-development-branch` to close out.

### Step 6 — Close the feature

Once every subtask work item is in a `completed` or `cancelled` state,
update the parent feature work item's state to `completed` and add a
closing comment summarizing what shipped, via `mcp__plane__workitem_comment`
with action `create`, `project_id`, `workitem_id=<feature id>`, and
`comment_html=<closing summary as HTML>`.

---

## Small Fixes

Trivial one-line changes don't need a Plane work item at all — use
judgment. Paper-trail ceremony is for things that qualify as a "feature,"
matching this skill's purpose.

---

## Common Mistakes

- **Forgetting to close the parent.** Completing every subtask does not
  close the feature — Step 6 requires a separate `workitem update` on the
  parent work item's `state`.
- **Passing a state name instead of a state id.** `workitem update`'s
  `state` field takes the UUID from `state list`, matched by `group`
  (`unstarted`/`started`/`completed`) — never a display name like "Done".
- **Not re-checking the gate mid-feature.** The user can switch back to
  `learning` mode between sessions; re-read `active-mode.txt` at the start
  of each session, not just once per feature.
- **Creating a new Page per feature instead of updating a topic reference
  doc.** This was this skill's original design and produced exactly the
  problem reference docs exist to avoid: disconnected, one-off pages named
  after whatever feature created them, each a frozen snapshot with no
  synthesis across changes to the same subsystem. Always check for an
  existing reference doc covering the topic first (Step 2.3) before
  creating a new Page.
- **Opening a full paper trail for trivial fixes.** See "Small Fixes" above
  — use judgment before creating a work item for a one-line change.
- **HTML-escaping `_html` fields.** `description_html` and `comment_html`
  want literal `<p>`/`<h2>`/`<ul>` tags, not `&lt;p&gt;`-escaped entities —
  escaping them makes Plane display the raw tags as visible text instead of
  formatting. If this happens, there's no `page update`/`workitem` field fix
  for a page body — re-`create` the page with corrected HTML, `attach_to_workitem`
  the new one, and `detach_from_workitem` the old (its `workitem_page_id`
  comes from `list_workitem_pages`, not the page id itself).
- **Assuming `attach_to_workitem` succeeded without checking.** Always
  follow it with `list_workitem_pages` to confirm the page shows up linked
  to the work item.

---

## Handling Plane Being Unreachable

If any `mcp__plane__*` call fails, don't block local work: warn the user
once, continue with the git/plan work locally, and note the missed sync
(e.g. in the plan file or a commit message) so it can be reconciled once
Plane is reachable again.
