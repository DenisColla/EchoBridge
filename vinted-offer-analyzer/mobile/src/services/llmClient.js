import { authHeaders, buildLlmRequest, llmCost, modelByKey, parseLlmResponse, readModelJson } from '../../core/index.js'
import { xhrRequest } from './http.js'
import { getApiKey } from './secrets.js'

/**
 * One AI call from the phone: request shape from core/llm.js, key from the secure store, timeout, at most two retries
 * on rate limits / server errors / empty answers (honouring Retry-After), then schema validation of the answer.
 * Never throws: returns { ok, value, text, problems, usage, costUsd, latencyMs, error, kind }.
 */
/** A wait that ends early when the run is cancelled (Retry-After can ask for up to 30 s). */
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve()
  const done = () => {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', done)
    resolve()
  }
  const timer = setTimeout(done, ms)
  if (signal) signal.addEventListener('abort', done)
})

function retryDelay(response, attempt) {
  const header = response && response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null
  const seconds = header && /^\d+(\.\d+)?$/.test(header) ? Number(header) : null
  if (seconds != null) return Math.min(30_000, seconds * 1000)
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400)
}

export async function callModel(modelKey, prompt, images = [], { effort = 'low', maxTokens = 1500, timeoutMs = 90_000, signal, maxAttempts = 3, think, temperature } = {}) {
  const model = modelByKey(modelKey)
  if (!model) return { ok: false, error: `Modello sconosciuto: ${modelKey}`, kind: 'request', costUsd: 0, latencyMs: 0 }
  const key = await getApiKey(model.provider)
  if (!key) return { ok: false, error: 'Chiave mancante', kind: 'auth', costUsd: 0, latencyMs: 0 }
  let request
  try {
    request = buildLlmRequest(modelKey, prompt, images, { effort, maxTokens, think, temperature })
  } catch (e) {
    return { ok: false, error: String(e.message || e), kind: 'request', costUsd: 0, latencyMs: 0 }
  }
  const started = Date.now()
  let spent = 0
  let last = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal && signal.aborted) return { ok: false, error: 'Annullato', kind: 'cancelled', costUsd: spent, latencyMs: Date.now() - started }
    // xhrRequest, not fetch: the answer must arrive with the app behind too (see http.js). Its timeout is the network
    // layer's own.
    const got = await xhrRequest({ method: 'POST', url: request.url, headers: { ...request.headers, ...authHeaders(model.provider, key) }, body: JSON.stringify(request.body), timeoutMs, signal })
    const response = got.text === null ? null : { status: got.status, headers: { get: (name) => got.header(name) } }
    if (response) {
      let json = null
      try {
        json = got.text ? JSON.parse(got.text.trim()) : null
      } catch {
        json = null
      }
      last = parseLlmResponse(model.provider, got.status, json, got.text, response.headers)
    } else if (got.error === 'cancelled') last = { ok: false, error: 'Annullato', retryable: false, kind: 'cancelled' }
    else last = { ok: false, error: got.error === 'timeout' ? `Nessuna risposta entro ${Math.round(timeoutMs / 1000)} s` : 'Rete: richiesta non riuscita', retryable: true, kind: 'network' }
    // A call that produced tokens is billed even when its answer is unusable.
    if (last.usage) spent += llmCost(modelKey, last.usage, new Date()) || 0
    if (last.ok || !last.retryable || attempt === maxAttempts - 1) break
    await sleep(retryDelay(response, attempt), signal)
  }
  const latencyMs = Date.now() - started
  if (!last.ok) return { ok: false, text: last.text || '', error: last.error, kind: last.kind, usage: last.usage, costUsd: spent, latencyMs }
  let parsed
  try {
    parsed = readModelJson(last.text, prompt.schema)
  } catch (e) {
    parsed = { ok: false, value: null, problems: [String(e && e.message ? e.message : e)] }
  }
  return { ok: parsed.ok, value: parsed.value, text: last.text, problems: parsed.problems, error: parsed.ok ? null : `Risposta fuori schema: ${parsed.problems.slice(0, 3).join('; ')}`, kind: parsed.ok ? null : 'schema', usage: last.usage, costUsd: spent, latencyMs }
}

/** A tiny call to check a key: answers {"ok": true}. Costs a fraction of a cent. */
export function testKey(modelKey) {
  const prompt = {
    system: 'Rispondi solo con un oggetto json.',
    text: 'Restituisci {"ok": true} in json.',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    schemaName: 'prova',
  }
  return callModel(modelKey, prompt, [], { effort: 'low', maxTokens: 800, timeoutMs: 45_000 })
}
