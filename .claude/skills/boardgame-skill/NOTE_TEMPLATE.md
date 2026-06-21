# [Topic Label]

**Phase:** [Phase number and name]
**Topic ID:** [topic_id]
**Date:** [YYYY-MM-DD]
**SecOps:** [Yes / No]

---

## What Is This?

[2–3 sentences. Explain the concept in plain language, as if talking to
someone who has never encountered it. No jargon without definition.]

---

## Why Does It Matter for This Project?

[1–2 sentences connecting this concept directly to the board game platform.
Not generic — specific. E.g. "This is why our Keycloak JWT validation can
be reused for WebSocket connections without rewriting the guard."]

---

## The Decision

[What decision is being made here? What were the alternatives considered?
Why was this approach chosen over the alternatives?

Format as:
  Chose: [approach]
  Because: [reason]
  Alternative: [other approach]
  Drawback of alternative: [why it was rejected]]

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

[Describe a minimal scenario that demonstrates the concept. Keep it simple
enough to hold in your head completely.]

### Code / Configuration

```[language]
[Worked example code here. Should be complete and runnable in isolation.
Include comments explaining every non-obvious line.]
```

### What Is Happening Step by Step

[Walk through the example line by line or step by step. Explain what each
part does and why it is written that way. This is the most important section.]

1. [Step 1 explanation]
2. [Step 2 explanation]
3. [Step 3 explanation]
...

### What Would Break If You Changed X?

[Pick one key line or configuration value from the example. Describe what
would happen — concretely — if it were removed or changed. This builds
intuition for why things are the way they are.]

---

## Now Apply It

[Describe where exactly this concept appears in the actual board game
platform codebase. Be specific — which file, which module, which table.
Connect the worked example to the real implementation.]

Files to look at after this note:
- `[path/to/file.ts]` — [what to look for there]
- `[path/to/file.ts]` — [what to look for there]

---

## SecOps Notes

[Only present if SecOps: Yes. Describe the security property being upheld,
what attack it mitigates, and what would go wrong if this step were skipped.
Reference the checklist from references/secops.md.]

---

## Checkpoint Questions

[3–5 questions the user should be able to answer after this topic.
These are the questions Claude Code will ask during the checkpoint step.]

1. [Question testing conceptual understanding]
2. [Question testing ability to debug or reason about failure]
3. [Question testing connection to the broader system]
4. [Question testing a specific implementation detail]
5. [Question testing the "why" behind a key decision]

---

## Rewrite Exercise

[Only present if rewrite: true for this topic.]

Delete the files generated in this session and recreate them from memory.
Use this note as a reference for concepts, but do not look at the generated
code.

Focus on: [specific aspect to get right — the part most likely to be
forgotten or misunderstood]

It is fine if your version differs from the generated one — what matters
is that you can explain every line you write.

---

## Summary

[Filled in by Claude Code after the checkpoint is complete.]

Built: [what was built]
Demonstrated understanding of: [what the user showed they understood]
To revisit: [any gaps identified during checkpoint]
