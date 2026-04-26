# MD Template Home Task List

## Goal

Implement a template-first Rocky home flow for non-technical MD users:

- Home starts from saved template cards instead of a blank chat-only surface.
- Template execution still happens conversationally, with Rocky asking for the next required input.
- A new Templates menu lets users create Rocky work abilities through a guided questionnaire.
- Built-in starting templates cover document extraction, content production, and data analysis.

## Tasks

- [x] Capture the implementation task list in this repository.
- [x] Add a front-end template model, built-in MD template presets, local persistence, and prompt generation.
- [x] Add a Templates route/menu for no-code template creation, editing, and deletion.
- [x] Update Home so saved/built-in templates appear as executable cards and launch Rocky step-by-step.
- [x] Validate with focused tests and web typecheck/build.

## Product Notes

- A template is not just a document format. It is a saved work ability Rocky can run.
- The home screen should stay operational and lightweight: template cards, recent work, file upload, and chat input.
- Template creation should feel like "teach Rocky my work", not like writing prompts or configuring automation.
- Card execution should start from a preparation panel, not by silently injecting a template as chat context.

## Follow-up Tasks

- [x] Remove visible built-in/default templates from Home and Templates.
- [x] Change "new template" into a step-by-step Rocky interview.
- [x] Infer category, required inputs, output format, and rules from the user's natural-language answers.
- [x] Generate OpenAI Skill-shaped files (`SKILL.md` and `agents/openai.yaml`) for each saved template and sync them to Rocky Core when possible.
- [x] Add a template execution preparation dialog with file selection, required-input checklist, workflow preview, and per-run notes before chat execution.
- [x] Route template interview answers through Rocky Core so the LLM agent can process each answer.
- [x] Show the generated draft only after the interview reaches review.
- [x] Hide internal skill identifiers from user-facing template cards and dialogs.
