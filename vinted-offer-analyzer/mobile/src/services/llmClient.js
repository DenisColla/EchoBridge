import { authHeaders, buildLlmRequest, llmCost, modelByKey, parseLlmResponse, readModelJson } from '../../core/index.js'
import { getApiKey } from './secrets.js'

/**
 * One AI call from the phone: request shape from core/llm.js, key from the secure store, timeout, at most two retries
 * on rate limits / server errors / empty answers (honouring Retry-After), then schema validation of the answer.
 * Never throws: returns { ok, value, text, problems, usage, costUsd, latencyMs, error, kind }.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function retryDelay(response, attempt) {
  const header = response && response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null
  const seconds = header && /^\d+(\.\d+)?$/.test(header) ? Number(header) : null
  if (seconds != null) return Math.min(30_000, seconds * 1000)
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400)
}

export async function callModel(modelKey, prompt, images = [], { effort = 'low', maxTokens = 1500, timeoutMs = 90_000, signal } = {}) {
  const model = modelByKey(modelKey)
  if (!model) return { ok: false, error: `Modello sconosciuto: ${modelKey}`, kind: 'request', costUsd: 0, latencyMs: 0 }
  const key = await getApiKey(model.provider)
  if (!key) return { ok: false, error: 'Chiave mancante', kind: 'auth', costUsd: 0, latencyMs: 0 }
  let request
  try {
    request = buildLlmRequest(modelKey, prompt, images, { effort, maxTokens })
  } catch (e) {
    return { ok: false, error: String(e.message || e), kind: 'request', costUsd: 0, latencyMs: 0 }
  }
  const started = Date.now()
  let spent = 0
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal && signal.aborted) return { ok: false, error: 'Annullato', kind: 'cancelled', costUsd: spent, latencyMs: Date.now() - started }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort)
    let response = null
    try {
      response = await fetch(request.url, { method: 'POST', headers: { ...request.headers, ...authHeaders(model.provider, key) }, body: JSON.stringify(request.body), signal: controller.signal })
      const raw = await response.text()
      let json = null
      try {
        json = raw ? JSON.parse(raw.trim()) : null
      } catch {
        json = null
      }
      last = parseLlmResponse(model.provider, response.status, json, raw, response.headers)
    } catch (e) {
      const aborted = e && e.name === 'AbortError'
      last = { ok: false, error: aborted ? (signal && signal.aborted ? 'Annullato' : `Nessuna risposta entro ${Math.round(timeoutMs / 1000)} s`) : `Rete: ${String(e && e.message ? e.message : e)}`, retryable: !(signal && signal.aborted), kind: aborted && signal && signal.aborted ? 'cancelled' : 'network' }
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    // A call that produced tokens is billed even when its answer is unusable.
    if (last.usage) spent += llmCost(modelKey, last.usage, new Date()) || 0
    if (last.ok || !last.retryable || attempt === 2) break
    await sleep(retryDelay(response, attempt))
  }
  const latencyMs = Date.now() - started
  if (!last.ok) return { ok: false, text: last.text || '', error: last.error, kind: last.kind, usage: last.usage, costUsd: spent, latencyMs }
  const parsed = readModelJson(last.text, prompt.schema)
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
