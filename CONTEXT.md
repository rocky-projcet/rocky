# Rocky

Rocky manages local agent workspaces and account connectors so agents can understand which external actions are safe, blocked, or only planned.

## Language

**Connector**:
A Rocky-managed relationship between an agent workflow and an external account or service.
_Avoid_: integration when referring to the account state itself

**Capability**:
A discrete external action or read that Rocky can expose to an agent under connector rules.
_Avoid_: feature, tool

**ECOUNT ERP connection**:
A Rocky-managed connector to an ECOUNT ERP company account for business data lookups under Open API prerequisites.
_Avoid_: ECOUNT login when referring to API readiness

**ECOUNT read capability**:
An ECOUNT capability that retrieves ERP records for analysis without creating or modifying ERP data.
_Avoid_: ECOUNT write, ECOUNT sync

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
A browser login Rocky may use only for capabilities whose execution boundary explicitly names browser assist; it does not make API capabilities available by itself.
_Avoid_: browser credential, browser token

**ECOUNT Open API connection**:
A connector authorization for official ECOUNT Open API reads, bounded by company code, API key issuer, API key, and zone.
_Avoid_: ECOUNT web login, ECOUNT connection

**ECOUNT API key issuer**:
The ECOUNT user identity that issued the Open API key used for ECOUNT Open API login.
_Avoid_: web login ID, account ID

**ECOUNT web session**:
A browser-authenticated ECOUNT ERP session used for browser-assist read capabilities.
_Avoid_: OAPI session, API credential

**ECOUNT web login identity**:
The ECOUNT user identity used to authenticate into the ECOUNT ERP web UI.
_Avoid_: API key issuer

**ECOUNT sales export**:
A read-only ECOUNT browser-assist capability that turns sales inquiry data into a managed export artifact.
_Avoid_: sales OAPI lookup, internal sales API

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
- An **ECOUNT ERP connection** exposes zero or more **ECOUNT read capabilities**.
- An **Instagram Graph API connection** is a kind of **Rocky-managed OAuth connection**.
- A **Browser assist session** may make browser-assist capabilities available, but it does not make API capabilities available.
- An **Instagram Graph API connection** may have a **Browser assist session**, but the session does not make Instagram Graph API capabilities available.
- An **ECOUNT Open API connection** uses exactly one **ECOUNT API key issuer**.
- An **ECOUNT web session** authenticates exactly one **ECOUNT web login identity**.
- An **ECOUNT API key issuer** may differ from the **ECOUNT web login identity** for the same ERP company.
- An **ECOUNT sales export** requires an **ECOUNT web session** and does not require an **ECOUNT Open API connection**.
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
>
> **Dev:** "The **ECOUNT Open API connection** tested successfully; can we run an **ECOUNT sales export**?"
> **Domain expert:** "Not unless the **ECOUNT web session** is also ready. The **ECOUNT API key issuer** is not assumed to be the **ECOUNT web login identity**."

## Flagged Ambiguities

- "Instagram connection" can mean either browser login or Graph API readiness; resolved: execution language must say **Instagram Graph API connection**, and browser-only flows must say **Browser assist session**.
- "Instagram Graph API connection" previously implied a Facebook Page boundary; resolved: the default Rocky flow uses Instagram Login for Business and treats the Instagram User ID as the execution boundary.
- "Browser assist session" was used as if it were always manual-only; resolved: it can support browser-assist capabilities, but never makes API capabilities available by itself.
- "ECOUNT connection" can mean either Open API readiness or web login readiness; resolved: use **ECOUNT Open API connection** for official API reads and **ECOUNT web session** for browser-assist reads.
- "USER_ID" can mean either **ECOUNT API key issuer** or **ECOUNT web login identity**; resolved: never assume those identities are the same.
- "sales lookup" can mean official API read or browser export; resolved: use **ECOUNT sales export** when sales data comes from the ERP web inquiry/export path.
- "broker" was used to mean both OAuth authorization and publish execution; resolved: **OAuth broker** is authorization-only, and posting is **Instagram publish execution**.
- "approval" was used to mean an agent-written JSON flag; resolved: **Publish approval** is a user authorization held by Rocky, not by the agent workspace.
- "ECOUNT 조회" was used broadly enough to include ERP input APIs useful for analysis; resolved: **ECOUNT read capability** includes only lookup APIs that retrieve ERP records without mutation.
