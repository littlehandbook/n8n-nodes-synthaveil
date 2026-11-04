#!/usr/bin/env node
/**
 * Capture golden fixtures from a live TAAS staging deployment for the OpenAPI
 * parity test (tests/api/fixtures/v1/*.json). Env-gated + synthetic-input-only.
 *
 * Usage:
 *   TAAS_STAGING_URL=https://staging.synthaveil.com \
 *   TAAS_STAGING_KEY=sk_... \
 *   node integrations/n8n-nodes-taas/scripts/capture-fixtures.mjs
 *
 * When the env vars are absent the script exits 0 with a notice — it never fails a
 * gate. The checked-in fixtures are hand-authored from the route response
 * construction until staging is reachable; re-running this OVERWRITES them with
 * live captures (and flips each `_meta.source`).
 *
 * Captures record STATUS + selected response HEADERS into `_meta` (review RF-4);
 * the parity test asserts the standard-header set on fixtures carrying
 * `_meta.headers`. Error captures use deterministic provocations (bad key,
 * over-cap record); quota/rate-limit states are tenant-dependent and stay
 * hand-authored unless this run happens to hit them.
 *
 * Inputs are SYNTHETIC only (Jane Smith / demo values). Never point this at real
 * PII. Responses from an irreversible hosted surface contain synthetic outputs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT_DIR = join(REPO_ROOT, 'tests/api/fixtures/v1')

const BASE = process.env.TAAS_STAGING_URL
const KEY = process.env.TAAS_STAGING_KEY

if (!BASE || !KEY) {
  console.log(
    '[capture-fixtures] TAAS_STAGING_URL / TAAS_STAGING_KEY not set — skipping live capture.\n' +
      '  The checked-in fixtures are hand-authored from route code; set both env vars\n' +
      '  to replace them with live staging captures. Exiting 0 (never fails a gate).'
  )
  process.exit(0)
}

/** Response headers worth pinning in fixtures (parity test RF-4 header leg). */
const CAPTURED_HEADERS = [
  'cache-control',
  'x-taas-version',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-taas-quota-used',
  'x-taas-quota-limit',
  'x-taas-quota-warning',
  'retry-after',
]

const SYNTHETIC_RECORD = {
  record: { first_name: 'Jane', email: 'jane@example.com' },
  policy: {
    fields: {
      first_name: { method: 'l2.synthesize-name' },
      email: { method: 'l2.synthesize-email' },
    },
  },
  country: 'UK',
}

/** Over-cap record: 201 fields trips the 422 V1_TOKENIZE_MAX_FIELDS validation. */
function overCapBody() {
  const record = {}
  const fields = {}
  for (let i = 0; i <= 200; i++) {
    record[`f${i}`] = 'x'
    fields[`f${i}`] = { method: 'l1.token-stateless' }
  }
  return { record, policy: { fields } }
}

/**
 * One capture: file → { schema, method, path, body?, expectStatus, key? }.
 * `key` overrides the Bearer token (the 401 leg uses a garbage key).
 */
const CAPTURES = [
  {
    file: 'tokenize-200.json',
    schema: 'TokenizeResponse',
    method: 'POST',
    path: '/api/v1/tokenize',
    expectStatus: 200,
    body: SYNTHETIC_RECORD,
  },
  {
    file: 'batch-200.json',
    schema: 'BatchResponse',
    method: 'POST',
    path: '/api/v1/tokenize/batch',
    expectStatus: 200,
    body: {
      records: [{ first_name: 'Jane' }, { first_name: 'John' }],
      policy: { fields: { first_name: { method: 'l2.synthesize-name' } } },
      country: 'UK',
    },
  },
  {
    file: 'detect-200.json',
    schema: 'DetectResponse',
    method: 'POST',
    path: '/api/v1/detect',
    expectStatus: 200,
    body: { text: 'Jane Smith lives in London and works at Acme Ltd.' },
  },
  {
    file: 'usage-200.json',
    schema: 'UsageResponse',
    method: 'GET',
    path: '/api/v1/usage',
    expectStatus: 200,
  },
  {
    file: 'error-401-unauthorized.json',
    schema: 'Problem',
    method: 'POST',
    path: '/api/v1/tokenize',
    expectStatus: 401,
    body: SYNTHETIC_RECORD,
    key: 'sk_deliberately_invalid_capture_key',
  },
  {
    file: 'error-422-field-cap.json',
    schema: 'LegacyError',
    method: 'POST',
    path: '/api/v1/tokenize',
    expectStatus: 422,
    body: overCapBody(),
  },
]

async function call({ method, path, body, key }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key ?? KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { _raw: text }
  }
  const headers = {}
  for (const name of CAPTURED_HEADERS) {
    const value = res.headers.get(name)
    if (value !== null) headers[name] = value
  }
  return { status: res.status, json, headers }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const capturedAt = new Date().toISOString()
  for (const c of CAPTURES) {
    const { status, json, headers } = await call(c)
    if (status !== c.expectStatus) {
      console.warn(
        `[capture-fixtures] ${c.path} returned ${status} (expected ${c.expectStatus}); skipping ${c.file}`
      )
      continue
    }
    const fixture = {
      _meta: {
        schema: c.schema,
        endpoint: c.path,
        method: c.method,
        status,
        headers,
        source: `captured from staging ${capturedAt}`,
      },
      body: json,
    }
    writeFileSync(join(OUT_DIR, c.file), `${JSON.stringify(fixture, null, 2)}\n`)
    console.log(`[capture-fixtures] wrote ${c.file} (${status})`)
  }
}

main().catch((err) => {
  console.error('[capture-fixtures] failed:', err)
  process.exit(1)
})
