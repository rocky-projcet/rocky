---
name: requirement-understanding
description: >
  Explain how Codex understands listed requirements before implementation. Use
  when the user provides requirements, acceptance criteria, product notes,
  design feedback, or change requests and asks what they mean, how they should
  be interpreted, or whether the understanding is correct before proceeding.
---

# Requirement Understanding

## Goal

Turn a user's listed requirements into a concise, checkable interpretation
before planning or implementing work.

## Process

1. Restate each requirement in practical terms.
2. Separate explicit requirements from inferred intent.
3. Identify the affected product surface, user, data, behavior, and visual
   state when those can be inferred from context.
4. Call out ambiguity, missing constraints, or likely edge cases.
5. Describe what would count as done in observable acceptance terms.
6. Ask only the questions that block safe progress. If reasonable assumptions
   are enough, state them and continue.

## Response Shape

Prefer a short Korean response when the user asks in Korean.

Use this structure when it helps:

```markdown
제가 이해한 내용은 이렇습니다.

1. ...
2. ...

추가로 이렇게 해석했습니다:
- ...

확인이 필요한 부분:
- ...
```

Keep the response focused on understanding, not implementation detail. Mention
specific files, components, APIs, or tests only when the user already provided
technical context or asked for implementation next.

## Interpretation Rules

- Do not silently expand scope beyond the listed requirements.
- Do not convert product feedback into a technical solution too early.
- Preserve user wording that affects behavior, such as "hide", "replace",
  "default", "must", "general users", or "my configured settings".
- Distinguish "remove from UI" from "delete from data/API".
- Distinguish "use configured value" from "hard-code a new visual value".
- When a requirement says "like X" or "from X", treat X as the source of truth
  for consistency unless there is a clear conflict.
- End with the interpreted acceptance criteria when the user is likely to ask
  for implementation next.
