# Rocky

Rocky is a local-first personal assistant: one main agent, **Rocky**, manages what it knows about the user, does work directly or hands it to specialist agents, and surfaces only the decisions an AI cannot make. Rocky v2 runs its own thin agent harness instead of driving the Codex CLI (see `docs/v2/engine-design.md`). The v1 connector/ECOUNT/Instagram language is archived in `docs/archive/v1/CONTEXT.md`.

## Language

**Rocky (로키)**:
The single main agent the user does not create. It keeps the user's knowledge, works directly or delegates, designs and tunes agents, and escalates only decisions it cannot make.
_Avoid_: core agent, rocky-core

**Agent (에이전트)**:
A specialist sub-agent that Rocky proposes or the user creates. UI copy may call it a teammate (팀원).
_Avoid_: worker, employee, 직원

**Instructions (지침)**:
The system-prompt body that defines an agent's role, tone, and working rules.
_Avoid_: soul, persona

**Tuning mode (키우기 방식)**:
Who drives an agent's specialization: **with Rocky** (Rocky proposes changes) or **manual** (only the user edits; Rocky proposes only when asked).

**Duty (업무)**:
A recurring or ongoing piece of the user's work that has been handed over: what, when, deliverable, success criteria, and things not to do. A duty has one owner agent and one trust level.
_Avoid_: task, skill

**Trust level (위임 단계)**:
How much of a duty is delegated: 0 together (함께 하기), 1 draft only (초안까지), 2 act and report (하고 보고), 3 hand off (맡기기).
_Avoid_: automation level

**Decision (결정)**:
A question, approval, permission, or proposal that an AI cannot resolve and that waits for the user.
_Avoid_: notification, JSON approval

**Delegation (위임)**:
Rocky (or an agent) handing work to another agent; it creates exactly one child session.
_Avoid_: dispatch, handoff

**Knowledge (지식)**:
What Rocky knows about the user (self, people, projects, preferences, rules), stored as local Markdown files.
_Avoid_: memory (reserved for implementation detail)

**Connection (연결)**:
One authenticated model provider: ChatGPT subscription, OpenAI API, Anthropic API, or an OpenAI-compatible endpoint such as a local model server.
_Avoid_: account, auth profile

**Tool (도구)**:
A function an agent can call, classified by risk: read, write, exec, or external.
_Avoid_: skill, capability

## Relationships

- There is exactly one **Rocky**; there are zero or more **Agents**.
- An **Agent** has one set of **Instructions**, a tool list, a model choice, a **Knowledge** scope, and a workspace; changes to them are versioned.
- A **Duty** has exactly one owner (an **Agent** or **Rocky**) and exactly one **Trust level**.
- An agent's question goes to **Rocky** first; Rocky answers from **Knowledge** when it can, otherwise it becomes a **Decision**.
- A **Trust level** rises only when the user approves Rocky's proposal; the user can lower it at any time.
- A **Delegation** creates exactly one child session under the delegating session.

## Flagged Ambiguities

- "Claude subscription" cannot back Rocky's own harness: Anthropic does not allow third-party apps to use claude.ai login. Claude models connect through an Anthropic API key (Max/Team plans include monthly API credits).
- "Skill" is not a v2 concept. Agent behavior comes from **Instructions**, **Tools**, and **Duties**; reusable procedures may return later as agent-scoped playbooks.
