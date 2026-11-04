# n8n-nodes-synthaveil

An [n8n](https://n8n.io) community node for **Synthaveil** — deterministic,
format-preserving tokenisation of personal data over the hosted `/api/v1` surface.

Use it to anonymise customer records **before** they reach an LLM, a third-party
API, a data warehouse, or a spreadsheet — without breaking joins, formats, or
downstream analytics.

## What it does

Most masking tools blank personal data out (`[REDACTED]`), which destroys its
analytic value. Synthaveil instead swaps each value for a **realistic, consistent
synthetic stand-in**:

- **Consistent** — the same input maps to the same replacement within a scope, so
  joins and counts still work after anonymisation.
- **Format-preserving** — an email stays an email, a phone number keeps its shape.
- **One-way at the API** — the hosted API only ever produces protected values.
  It has no endpoint that turns a token back into the original, in any mode.

Your LLM sees realistic, consistent synthetic data — so your analytics survive.

## How the round trip works

The question everyone asks first: _if the names are swapped, how do I get the
model's answer back onto the right customer?_

You do not need the real names to come back. You need to know **which row** the
answer belongs to — and that is your own record ID, which the node never touches.

1. **In.** Your record arrives with an ID you already have (`id`, `ticket_no`,
   `account_ref` — whatever you use). You list only the personal fields for the
   node to swap: name, email, phone.
2. **Through.** The node swaps those fields and passes the record on. The ID
   travels alongside, untouched, because it is not personal data. The model sees
   `Marcus Webb`, not `Jane Testerson` — and it sees your ID.
3. **Back.** The model answers. Its output still carries the ID. You merge on
   that ID and write the answer to the right row in your CRM.

Worked example — a support-ticket summariser:

| Step             | `id`     | `name`                                 | `body`                                      |
| ---------------- | -------- | -------------------------------------- | ------------------------------------------- |
| From your CRM    | `T-4821` | `Jane Testerson`                       | "Jane called about her invoice…"            |
| After Synthaveil | `T-4821` | `Marcus Webb`                          | "Marcus called about his invoice…"          |
| Model output     | `T-4821` | —                                      | "Summary: billing query, needs a callback." |
| Written back     | `T-4821` | `Jane Testerson` (never left your CRM) | summary attached                            |

**In Record ID mode, no mapping is stored anywhere — not on your n8n, not at
Synthaveil.** There is nothing to leak, nothing to expire and nothing to delete,
because the link between `Jane Testerson` and `Marcus Webb` is never written down
by anybody. Your CRM already knows who `T-4821` is; that is the only join you need.

The one thing this mode cannot do is un-swap **free text**. If you need the
model's prose to come back with the real names in it, that is `Return mode =
Local restore`: **the map is sealed on your n8n with a key that never leaves it;
Synthaveil stores bytes it cannot open and destroys them the moment it hands the
map back (one-shot).** It is a `Return mode` setting on the node, and it is the
only mode that involves a map at all.

## What Synthaveil can and cannot see

|                                                        | **Record ID mode**                           | **Local restore mode**                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Your real values, while the request is being processed | Yes — that is what tokenisation is           | Yes — that is what tokenisation is                                                                                            |
| Your real values, stored afterwards                    | **No**                                       | **No**                                                                                                                        |
| The mapping from real value to synthetic value         | **No — it is never created, by anyone**      | **No** — Synthaveil sees only opaque sealed bytes it has no key to open                                                       |
| Your record IDs                                        | **No** — they are never sent to the API      | **No** — a sealed map's inner contents (record IDs, field paths, scope labels) are inside the seal, not readable by the store |
| Your synthetic (swapped) values                        | Yes, in transit; not retained as a map       | Yes, in transit; not retained after the map is destroyed                                                                      |
| Your scope label                                       | Yes — treat it as a label, not a client name | **No** — the scope label lives inside the sealed bytes; the store only ever sees an HMAC of it                                |
| Your map key                                           | N/A — this mode has no map                   | **No — it never leaves your n8n**                                                                                             |
| Sizes and timestamps of a sealed map                   | N/A                                          | Yes — the store tracks the blob size and when it was stored/expires, to run the sweep                                         |
| The model's answer                                     | **No** — the model call is yours, not ours   | **No** — the model call is yours, not ours                                                                                    |

## Install

**Self-hosted, via the n8n UI**

1. Open **Settings → Community Nodes → Install**.
2. Enter the package name `n8n-nodes-synthaveil` and confirm.

**Self-hosted, via environment / npm**

```bash
# in your n8n instance
npm install n8n-nodes-synthaveil
# and set (once) to allow community nodes:
export N8N_COMMUNITY_PACKAGES_ENABLED=true
```

**n8n Cloud** — installation on n8n Cloud is **pending verification** of this
package by n8n. Until then, use a self-hosted instance.

> **Activation requires your own Synthaveil API key.** Create one in the
> Synthaveil portal (API Keys) — the node never works without it. Installing the
> package is not enough; there is no shared or trial key baked in.

## Quickstart for new users

Everything below happens once. It takes a few minutes.

1. **Create an account** at [Synthaveil](https://synthaveil.com).
2. In the portal, open **API Keys → Create key**. Grant the key **both**
   `tokenize:read` **and** `tokenize:write` scopes. (Read alone lets you check
   usage and scan text; write is required to tokenise.)
3. **Sign the Data Processing Agreement** in the portal under **Commercial → DPA**.
   Your first tokenize call fails with a `dpa_required` error until this is signed.
4. In n8n, add a **Synthaveil API** credential: pick **Base URL** from the
   dropdown (Production is the only option unless you need a self-hosted or
   test endpoint — see below) and paste your **API Key**. The credential test
   calls `GET /api/v1/usage`; a passing test confirms the key and read scope,
   but not write scope or the DPA.
5. Import and run the example workflow at
   [`examples/crm-anonymise-llm.workflow.json`](./examples/crm-anonymise-llm.workflow.json).
6. For the Local restore mode, see
   [`examples/crm-local-restore.workflow.json`](./examples/crm-local-restore.workflow.json)
   — a Tokenize → AI step → Restore round trip, plus a disabled branch showing
   what the wrong-credential failure looks like. This example has **not yet
   been executed against a live instance**; running it end to end needs a real
   API key with the `restore` scope and a Synthaveil Map Key credential.

### Existing credentials after upgrade

**Base URL** used to be free text; it is now a closed list (production only —
there is no staging host in this product). If you saved a credential before
this change:

- A credential already pointing at the production host needs no action.
- A credential pointing anywhere else (a hand-typed staging/self-hosted URL, or
  one loaded from an old workflow export) now fails, at **both** Test time and
  execution time, asking you to re-select the API host. Open the credential,
  re-pick **Base URL** from the list, and — if you genuinely need a
  non-production endpoint — tick **Allow non-production URL (local
  development)** and put that host in the new **Base URL Override** field
  instead.
- The credential **Test** button and node execution resolve the target through
  one shared selector, so they always give the same verdict and run the same
  SSRF checks. Test never reports success for a credential execution would
  refuse, and it never sends your API key to a host you didn't configure.
- Ticking **Allow non-production URL** on its own is no longer enough: with the
  toggle on and **Base URL Override** left empty, both Test and execution
  refuse until you fill the override in. The toggle relaxes the host rules for
  the override value only, never for the **Base URL** you picked from the list.
  https is still required everywhere except a localhost override.

## Operations reference

| Resource | Operation            | What it does                                                                                                    |
| -------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Token    | **Tokenize**         | Protect the mapped fields of a single record.                                                                   |
| Token    | **Tokenize (Batch)** | Protect the mapped fields across many records in one request (up to 100; 50 when any field uses an L3 method).  |
| Text     | **Scan Text**        | Find personal-data spans in a free-text field. Read-only — it does **not** tokenise or auto-configure a policy. |
| Account  | **Get Usage**        | Read the current period usage, quota, and tier.                                                                 |

### Tokenization methods

You map each field to one method. Methods are grouped by level; higher levels
produce more statistically realistic values.

| Method                                                                                            | What it produces                                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| L1 — Redact (Stateless Token)                                                                     | An opaque deterministic token.                                                                      |
| L1 — Pseudonym                                                                                    | A consistent stand-in (same input → same pseudonym).                                                |
| L1 — Keyed Hash                                                                                   | A one-way keyed hash — cannot be turned back into the original, but still matchable across records. |
| L2 — Synthetic Name / Email / Phone / Address / Postcode / Date of Birth                          | A realistic, locale-aware replacement with the original format preserved.                           |
| L2 — Synthetic Company Name / Company Number / VAT / SIC / LEI / IBAN / Card Number / National ID | A realistic replacement identifier that keeps its format.                                           |
| L3 — Realistic First Name / Surname / Full Name                                                   | A statistically realistic name drawn from population data.                                          |
| L3 — Realistic Location                                                                           | A nearby realistic location that preserves area characteristics.                                    |
| L3 — Realistic Company                                                                            | A statistically realistic company drawn from real company data.                                     |

> **Only the fields you map are sent to the API.** Any other field on the item
> stays in n8n and never leaves your instance.

### Consistency scope (`scope_id`)

The **Scope ID** option controls how consistent your tokens are across runs:

- **Set a scope** (e.g. `crm-sync`) and the same input value always maps to the
  same replacement within that scope — so records join across workflows and runs.
- **Leave it empty** and tokens **rotate daily** — the same value maps to a
  different replacement tomorrow.

Sharp edge: changing a field's **method** or its **scope** produces different
tokens for the same value. Pick a scope and method up front and keep them stable.

**One scope per end-customer is a security rule, not a suggestion.** Sharing a
scope across two different clients merges their token spaces — one client's
values can start colliding with another's. If you run workflows for multiple
end-customers (an agency, for example), give each one its own `Scope ID`. Scope
labels are metadata, not client names — don't put anything you wouldn't want
Synthaveil to see in a label; it is only ever used to keep token spaces apart.
**Scope IDs are case-sensitive** — `crm-sync` and `CRM-Sync` are two different
scopes.

### Consistency: Stable vs. Every run

- **Stable** (default, recommended): the same real value always gets the same
  fake value inside a scope, across every run. This is what most workflows want.
- **Every run**: not recommended for most workflows. A person keeps one fake
  name inside a single run, but gets a different fake name the next time the
  workflow runs. Example: Helen appears four times in a document — every run
  she is one consistent "Mary", but tomorrow's run turns her into "Sarah". You
  cannot match, count or de-duplicate people across runs, and an AI step cannot
  remember that Helen is Mary from one run to the next. Choose Stable when you
  need memory across runs.

## Batch billing

> Tokenize and Tokenize (Batch) are safe to retry: with Retry On Fail on, a
> retry in the same run is matched to the first attempt and not billed twice.
> When an AI agent uses this node as a tool, turn Retry On Fail off: n8n counts
> each tool retry as a new call. A retry is checked for its API key, rate limit and quota before it is matched,
> so it can still be refused (for example 402 if the first attempt used up your
> quota); a refused retry is not billed. Keep Retry On Fail off for Restore and Local restore. Batches bill every
> record sent, including error rows, and running the workflow again or retrying
> it from the Executions list is a new run and bills again.

**How a retry is matched.** Since 0.3.0 every Tokenize and Tokenize (Batch)
request carries an `Idempotency-Key` header. The key is built from your n8n
installation, the n8n execution, the node, this run of the node, the item (or the batch's first item)
and the exact data sent, so n8n's own Retry On Fail, which retries inside the
same execution, sends the same key, and two n8n installations never share one.
Once the first try has finished, Synthaveil answers the retry from its stored
response and does not bill it again. A retry still passes the same checks as any
request first (API key and scope, Data Processing Agreement, burst rate limit and
quota), and only then is it matched to the stored response. So if the first try
used up your last quota unit and its response was lost, the retry is refused with
`402 quota_exceeded` instead of being matched; nothing is billed for the refusal.
A separate run of the node in the same execution (a loop, or an AI agent calling
it as a tool again) carries its run number in the key, so it is a new request and
is billed as one. That is also why Retry On Fail is refused while an AI agent
uses the node as a tool: n8n gives each tool retry a new run number, so the retry
could not be matched and would be billed again. A new execution gets new keys. No key is
sent when n8n gives the node no installation id, execution id or run number; the node then
refuses to run Tokenize or Tokenize (Batch) with Retry On Fail on, because a
retry would be billed again.
If you turn Retry On Fail on for Tokenize or Tokenize (Batch), set Wait Between
Tries to its maximum (5000 ms; n8n allows no more). A request that failed on the
server stays locked for up to 60 seconds, so a retry inside that time can fail
with a "still finishing an earlier try" error; that try is not billed.

**What the node does on its own.** It retries once on HTTP 429 (rate limit),
which is not billed. If Synthaveil is still working on the first attempt of a
keyed request (`409 idempotency_conflict`), it waits the time the server asks
for, up to 60 seconds, and sends the same request once more. If the first try is
still unfinished, the node fails with the "still finishing" error and that try
is not billed. Every other failure surfaces to you rather than retrying silently.

**Restore and Local restore.** Restore refuses to run with Retry On Fail on: its
map is destroyed on first hand-over. Tokenize with Return Mode = Local restore
refuses it too: every retry would store another sealed map.

## Which country's names you get

The node sends **no `locale` and no `version`** in `policy` — the request body it
builds is `{ record, policy: { fields }, country?, scope_id?, run_id? }`
(`nodes/Taas/tokenize.ts`, `nodes/Taas/batch.ts`). A policy with no `version` is
treated as version 2 or below, which means every tokenise call from this node
runs the **legacy pre-17f name path** and draws its stand-in names from the
British `en-GB` list. Nothing in the response says so.

That is correct and stable today, because `en-GB` is the only name pack this
build ships — so the legacy path and an explicit `"locale": "en-GB"` produce
byte-identical names. It stops being correct the moment a second pack exists:
the node would keep silently producing British names while the API could offer a
choice, and a user could not tell from the output which list they got.

**A locale selector on the node is a blocking prerequisite before any second
locale pack ships.**

The node's `Locale hint` option is a different knob: it sets the top-level
`country` field, which overrides run-time **formats** (phone and postcode shapes)
only. It never chooses which country's names are drawn — that is `policy.locale`.

## Local restore

Set `Return mode` to **Local restore** on Tokenize to also get your real values
back inside free text — the AI model's own prose, not just a structured field.
The map that makes this possible never leaves your control: it is sealed on
your own n8n with a key only you hold, and the copy Synthaveil stores is bytes
it cannot open.

**Setup**

1. Generate a 32-byte key (the credential UI shows the exact command for your
   OS) and add it as a **Synthaveil Map Key (Local restore)** credential.
2. Your API key needs the `restore` scope in addition to `tokenize:read` and
   `tokenize:write` — a tokenize-only key can seal a map but cannot consume it
   for restore. Re-issue or extend your key with `restore` before your first
   Restore run.
3. Add a **Tokenize** node with `Return mode = Local restore`. It outputs a
   `synthaveil_map_handle` field alongside the tokenised record.
4. After your AI step, add a **Restore** node with `Map Handle` pointing at
   that field (`{{ $json.synthaveil_map_handle }}`) and `Text Field` pointing
   at the AI output field to restore.

**What Restore hands on.** The item leaves Restore in the shape it entered
Tokenize: every field intact (`id`, `name`, whatever you had), the `Text Field`
restored **in place**, plus a `restore_report` (`matched` / `unmatched` counts
of map entries found in the text). `synthaveil_map_handle` is removed — the map
it named has just been consumed and cannot be used again. If a restore fails
after the map was handed over, the item still carries its other fields, with
`failure_code` and `error` beside them and the text field left as it was.

**Turn off "Retry On Fail" for the Restore node.** The sealed map is destroyed
the moment it is handed over to your workflow — that hand-over only ever
happens once. If Restore is retried after that, there is no map left to apply,
and the node refuses to run at all with Retry On Fail switched on for the
Restore operation.

**Batch + Local restore is not supported yet.** `Tokenize (Batch)` with
`Return mode = Local restore` refuses to run rather than silently falling back
to Record ID behaviour. Use single **Tokenize** for Local restore today.

**If you lose the map key, every sealed map made with it is gone for good.**
The key never leaves your n8n instance and Synthaveil cannot recover it for
you — there is no support path that gets it back. Your n8n's own
`N8N_ENCRYPTION_KEY` protects the credential at rest, so back up both the map
key and `N8N_ENCRYPTION_KEY`, not just one of them.

### How the sealing works (`vendor/`)

The package bundles `@synthaveil/restore-protocol` (MIT) at
`vendor/restore-protocol.js` — this is the code that seals and opens maps under
your key, with zero runtime dependencies of its own.

**There is no public source link yet, and that is stated rather than faked.** The
package lives at `packages/restore-protocol` in the Synthaveil monorepo, which is
a PRIVATE repository, and it has not been published to npm. A README link to a
private repo reads as a source you can audit and returns a 404, so it has been
removed; it will be added when the package is published. Until then the bundle is
verifiable by hash, not by reading the source — see `vendor/HASH` below. `vendor/HASH` records a SHA-256 hash of that bundle so you (or CI) can
confirm it wasn't tampered with between builds. That hash is currently marked
**provisional**: it was cut from the workspace copy of `restore-protocol`
before the package's first publish to npm, and will be re-derived against the
published npm tarball once that publish happens.

## Using it as an AI Agent tool

This node sets `usableAsTool: true`, so an **AI Agent** node can call it to
anonymise data before the model sees it.

No extra environment variable is needed. Older guides tell you to set a
separate tool-usage opt-in; n8n removed that switch in
[#14042](https://github.com/n8n-io/n8n/pull/14042), so any community node
installed on the instance is available as an agent tool by default.

> **Verification note (for maintainers):** n8n issue
> [#26202](https://github.com/n8n-io/n8n/issues/26202) reports agents sometimes
> receiving an empty observation from community-node tools. This is verified
> empirically on the target n8n 2.x version as part of the E2E runbook; results
> are recorded there.

## What's new

**0.4.0** — clearer API-key scope guidance: the credential description and the 403
`insufficient_scope` message now say which scopes to tick. Wording only: existing
workflows are unchanged.

**Coming soon:** a new method, **L2 — Synthetic Town** (a fictional town or village
name). It is not in the method dropdown yet; it will be added in a later release once
the hosted API serves it.

## What changed in 0.3.1

**0.3.1** — Restore now refuses some text it used to restore: an accent mark
typed straight after a stand-in, or Korean text written as separate jamo
letters. The item fails with `failure_code` `INVALID_ENTRY` and the text field
is left as it was.

## What changed in 0.3.0

**0.3.0** — Tokenize and Tokenize (Batch) send an `Idempotency-Key`, so n8n's
Retry On Fail no longer double-bills inside one run (see
[Batch billing](#batch-billing)). An identical request inside one run is not
billed again: once the first has finished, it is answered from the stored
response. Tokenised responses are kept server-side for 30 days so a retry can
be answered from them. Tokenize with Return Mode = Local restore now refuses to
run with Retry On Fail on. The node version stays 1, so existing workflows need
no change.

## Breaking changes

**0.2.1 (2026-09-13)** — the United Kingdom locale hint now sends `GB` (the only
spelling the server accepts); `UK` returned a 400 since API 17f. **Workflows
saved under 0.2.0 are healed by the upgrade** and do not need re-editing: n8n
stores the chosen value in the workflow JSON, so correcting the dropdown alone
would have left every existing canvas sending `UK`. The node now rewrites a
persisted `UK` to `GB` as it builds the request. Later, non-breaking releases are
listed in the monorepo's `integrations/n8n-nodes-taas/CHANGELOG.md`.

**0.2.0 (2026-08-30)** — Record ID return mode; the public surfaces renamed to
Synthaveil.

**0.1.1 (2026-08-25):** the "Allow non-production URL (local development)"
credential toggle no longer disables the https requirement for remote hosts.
Plain-`http://` base URLs to a **remote** host are now rejected even with the
toggle on; `http://` remains available for loopback hosts only (`localhost`,
`127.0.0.1`, `[::1]`, `*.localhost`). Base-URL parsing/validation now always
runs, so a malformed base URL fails at execution time even with the toggle on
(previously the toggle skipped validation entirely). Non-synthaveil.com hosts over **https**
(e.g. an https tunnel) still work with the toggle, exactly as before.

## Troubleshooting

| You see                                                   | What it means                                                          | Do this                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `dpa_required`                                            | Your organisation has not signed the Data Processing Agreement.        | Sign your DPA in the Synthaveil **portal** (where you signed up and created this key), at the path `/commercial/dpa`. NOT your credential's Base URL — that is the API host `api.synthaveil.com`, which does not serve the portal, so `<baseUrl>/commercial/dpa` goes nowhere. |
| Credential test fails with **404**                        | The TAAS API is not enabled at this URL, or the Base URL is wrong.     | Check the Base URL and that API access is enabled for your account.                  |
| Credential test fails with **401**                        | The API key is invalid.                                                | Re-copy the key from the portal.                                                     |
| Credential test fails with **403** (`insufficient_scope`) | The key is valid but missing a scope.                                  | Re-issue the key with `tokenize:read` (the credential test needs it) and `tokenize:write`, plus `restore` if a Restore step uses it. |
| `l3_unavailable`                                          | L3 (realistic-data) methods are not enabled for your tenant right now. | Try again later, or choose an L1/L2 method.                                          |
| Rate limit / **429**                                      | Too many requests in a short window.                                   | Leave "Retry on Rate Limit" on (default) — it retries once, and a 429 is not billed. |
| Quota exceeded / **402**                                  | You have used your monthly quota.                                      | Upgrade your plan in the portal (the error carries an upgrade link).                 |
| `plan_required` / **402**                                 | Your organisation has no active plan, so its API keys are paused.      | Choose a plan in the portal; the same key works again once it is active.             |
| `plan_has_no_api_access` / **403**                        | Your plan does not include API keys.                                   | Move to a plan that includes API keys in the portal.                                 |

## License

[MIT](./LICENSE)
