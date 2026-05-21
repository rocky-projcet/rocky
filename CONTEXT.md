# Rocky

Rocky manages local agent workspaces and account connectors so agents can understand which external actions are safe, blocked, or only planned.

## Language

**Connector**:
A Rocky-managed relationship between an agent workflow and an external account or service.
_Avoid_: integration when referring to the account state itself

**Capability**:
A discrete external action or read that Rocky can expose to an agent under connector rules.
_Avoid_: feature, tool

**Available capability**:
A capability whose account, credential, and product conditions are ready for execution under Rocky policy.
_Avoid_: enabled

**Blocked capability**:
A capability that Rocky knows how to describe but cannot execute until the user resolves account or credential prerequisites.
_Avoid_: failed, broken

**Planned capability**:
A capability Rocky intentionally documents as future product scope rather than executable behavior.
_Avoid_: blocked

**Browser assist session**:
A browser login Rocky may use for manual help or readiness checks, never as an execution credential for Graph API actions.
_Avoid_: browser credential, browser token

**Instagram Graph API connection**:
An Instagram Professional account setup that uses Meta app, Page, permissions, token, and Instagram Business Account ID readiness as its execution boundary.
_Avoid_: Instagram login

## Relationships

- A **Connector** exposes zero or more **Capabilities**.
- A **Capability** is exactly one of **Available capability**, **Blocked capability**, or **Planned capability** when Rocky can classify it.
- An **Instagram Graph API connection** may have a **Browser assist session**, but the session does not make Graph API capabilities available.

## Example Dialogue

> **Dev:** "The user logged into Instagram in a browser, so can the agent publish?"
> **Domain expert:** "No. That is only a **Browser assist session**; publishing depends on an **Instagram Graph API connection** and an **Available capability**."

## Flagged Ambiguities

- "Instagram connection" can mean either browser login or Graph API readiness; resolved: execution language must say **Instagram Graph API connection**, and browser-only flows must say **Browser assist session**.
