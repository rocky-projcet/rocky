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

**Rocky-managed OAuth connection**:
A connector authorization mediated by Rocky-owned provider app credentials so installed-app users do not provide provider app secrets.
_Avoid_: local app secret, bundled app secret

**Instagram Graph API connection**:
A Rocky-managed OAuth connection for an Instagram Professional account whose app, permission, token, and Instagram User ID readiness form the execution boundary.
_Avoid_: Instagram login

**Tester invitation blocker**:
A blocked connector state where the provider app requires the user to accept a tester invitation before OAuth can complete.
_Avoid_: tester connection, app approval

**OAuth broker**:
A Rocky-operated authorization mediator for creating a **Rocky-managed OAuth connection**, not a publisher of Instagram media.
_Avoid_: publish broker, execution broker

**Instagram publish execution**:
The externally visible act of submitting approved Instagram media through an **Available capability** on an **Instagram Graph API connection**.
_Avoid_: broker publish, browser publish

**Publish approval**:
A user's explicit authorization for Rocky to perform a specific external write action.
_Avoid_: agent approval, implicit approval, JSON approval

**Publish draft**:
A proposed external post package awaiting **Publish approval**.
_Avoid_: publish request, JSON request

## Relationships

- A **Connector** exposes zero or more **Capabilities**.
- A **Capability** is exactly one of **Available capability**, **Blocked capability**, or **Planned capability** when Rocky can classify it.
- An **Instagram Graph API connection** is a kind of **Rocky-managed OAuth connection**.
- An **Instagram Graph API connection** may have a **Browser assist session**, but the session does not make Graph API capabilities available.
- A **Tester invitation blocker** prevents an **Instagram Graph API connection** until the user accepts the invitation and retries OAuth.
- An **OAuth broker** may help create an **Instagram Graph API connection**, but it does not perform **Instagram publish execution**.
- **Instagram publish execution** requires an **Available capability** and **Publish approval**.
- A **Publish draft** may receive **Publish approval** before **Instagram publish execution**.
- A Rocky task has at most one active Instagram **Publish draft** in the current product flow.
- A **Publish draft** that has completed **Instagram publish execution** must not be published again.

## Example Dialogue

> **Dev:** "The user logged into Instagram in a browser, so can the agent publish?"
> **Domain expert:** "No. That is only a **Browser assist session**; publishing depends on an **Instagram Graph API connection** and an **Available capability**."
>
> **Dev:** "Can the agent mark a JSON file as approved and publish it through the broker?"
> **Domain expert:** "No. The **OAuth broker** is only for authorization, and **Instagram publish execution** requires Rocky-held **Publish approval** for a **Publish draft**."

## Flagged Ambiguities

- "Instagram connection" can mean either browser login or Graph API readiness; resolved: execution language must say **Instagram Graph API connection**, and browser-only flows must say **Browser assist session**.
- "Instagram Graph API connection" previously implied a Facebook Page boundary; resolved: the default Rocky flow uses Instagram Login for Business and treats the Instagram User ID as the execution boundary.
- "broker" was used to mean both OAuth authorization and publish execution; resolved: **OAuth broker** is authorization-only, and posting is **Instagram publish execution**.
- "approval" was used to mean an agent-written JSON flag; resolved: **Publish approval** is a user authorization held by Rocky, not by the agent workspace.
