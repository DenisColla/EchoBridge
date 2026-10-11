/**
 * Raw HTTP shapes of the AI providers used by the lab. Pure functions: build the request (without the key) and read
 * the response; the app adds the key and does the fetch. The official SDKs of Anthropic and OpenAI state that React
 * Native is not supported, so the app talks plain JSON over HTTPS.
 *
 * Every shape below comes from the providers' official documentation as read on 2026-10-11 (sources in each entry).
 * Prices are list prices in USD per 1M tokens at that date: they can change, the report always shows them.
 */

export const LLM_PRICES_DATE = '2026-10-11'

/** Providers: what the user needs to create a key. */
export const LLM_PROVIDERS = {
  anthropic: { id: 'anthropic', label: 'Anthropic', keyHint: 'sk-ant-…', console: 'https://console.anthropic.com/settings/keys', note: 'Crea un\'area di lavoro dedicata con un limite di spesa mensile.' },
  openai: { id: 'openai', label: 'OpenAI', keyHint: 'sk-…', console: 'https://platform.openai.com/api-keys', note: 'Crea un progetto dedicato con un limite di spesa rigido.' },
  deepseek: { id: 'deepseek', label: 'DeepSeek', keyHint: 'sk-…', console: 'https://platform.deepseek.com/api_keys', note: 'Saldo prepagato. Dati trattati e conservati in Cina.' },
  qwen: { id: 'qwen', label: 'Alibaba Cloud (Qwen)', keyHint: 'sk-…', console: 'https://modelstudio.console.alibabacloud.com/', note: 'Model Studio internazionale, regione Singapore.' },
}

/**
 * The models under test. `pricing` per 1M tokens; DeepSeek has peak/off-peak rates (peak: 01:00–04:00 and
 * 06:00–10:00 UTC, Monday–Friday, excluding Chinese public holidays — the holidays are not modelled, so a weekday
 * holiday is costed at the peak rate, i.e. slightly over-estimated).
 */
export const LLM_MODELS = [
  {
    key: 'anthropic:claude-haiku-5-5', provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5',
    pricing: { input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, output: 0.50 },
    priceNote: 'Prompt fino a 100.000 token; oltre 0,50/2,50 $. Anthropic, listino 11/10/2026.',
  },
  {
    key: 'openai:gpt-6-luna', provider: 'openai', model: 'gpt-6-luna', label: 'OpenAI GPT-6 Luna',
    pricing: { input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, output: 0.50 },
    priceNote: 'Prompt fino a 272.000 token. Scrittura in cache 1,25× l\'input. OpenAI, listino 11/10/2026.',
  },
  {
    key: 'deepseek:deepseek-flash', provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek V4.1 Flash',
    pricing: { input: 0.30, cachedInput: 0.006, output: 1.20, offPeak: { input: 0.15, cachedInput: 0.003, output: 0.60 } },
    priceNote: 'Fascia di punta 01–04 e 06–10 UTC lun–ven; altrimenti metà prezzo. DeepSeek, listino 11/10/2026.',
  },
  {
    key: 'qwen:qwen3.8-flash', provider: 'qwen', model: 'qwen3.8-flash', label: 'Qwen 3.8 Flash',
    pricing: { input: 0.15, cachedInput: 0.15, output: 0.47 },
    priceNote: 'Model Studio internazionale (Singapore). Alibaba Cloud, listino 11/10/2026.',
  },
]

export const modelByKey = (key) => LLM_MODELS.find((m) => m.key === key) || null

/** How each provider is called in the two tests (shown in the report, so the comparison is transparent). */
export const LLM_METHOD = {
  anthropic: { verify: 'Messages API, ragionamento "low", output con schema JSON garantito', psych: 'ragionamento "medium" (predefinito del modello), schema JSON garantito' },
  openai: { verify: 'Responses API, ragionamento "low", Structured Outputs strict, store:false', psych: 'ragionamento "medium" (predefinito del modello), Structured Outputs strict' },
  deepseek: { verify: 'Chat Completions, ragionamento spento, modalità json_object (schema controllato dall\'app)', psych: 'ragionamento "low", json_object' },
  qwen: { verify: 'Chat Completions compatibile, ragionamento spento, json_object (con immagini lo schema non è applicato dal fornitore)', psych: 'ragionamento spento (il fornitore rifiuta json con ragionamento acceso), json_object' },
}

/** True during DeepSeek's peak window (UTC, Monday–Friday). */
export function deepseekPeakAt(date) {
  const d = date instanceof Date ? date : new Date(date)
  const day = d.getUTCDay()
  if (day === 0 || day === 6) return false
  const h = d.getUTCHours()
  return (h >= 1 && h < 4) || (h >= 6 && h < 10)
}

/**
 * Cost in USD of one call from its normalised usage: { input (all prompt tokens, images included), cachedInput (read
 * from cache), cacheWrite (written to cache), output (visible + reasoning) }.
 */
export function llmCost(modelKey, usage, at = new Date()) {
  const m = modelByKey(modelKey)
  if (!m || !usage) return null
  const p = m.pricing.offPeak && !deepseekPeakAt(at) ? m.pricing.offPeak : m.pricing
  const cached = Math.max(0, usage.cachedInput || 0)
  const written = Math.max(0, usage.cacheWrite || 0)
  const fresh = Math.max(0, (usage.input || 0) - cached - written)
  return (fresh * p.input + cached * (p.cachedInput ?? p.input) + written * (p.cacheWrite ?? p.input) + Math.max(0, usage.output || 0) * p.output) / 1e6
}

/** Typical tokens of one call (two 768 px photos + text; explanation), for the estimate shown before a run. */
const TYPICAL_TOKENS = { verify: { input: 3000, output: 400 }, psych: { input: 1000, output: 1200 } }

/** Rough cost of one call at list price (peak rate where there is one): a guide for the user, not a bill. */
export function estimateCallCost(modelKey, task) {
  const m = modelByKey(modelKey)
  const tk = TYPICAL_TOKENS[task]
  if (!m || !tk) return null
  return (tk.input * m.pricing.input + tk.output * m.pricing.output) / 1e6
}

/** Headers carrying the key, per provider. */
export function authHeaders(provider, key) {
  if (provider === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  return { Authorization: `Bearer ${key}` }
}

/**
 * Builds the request of one call. `prompt` = { system, text, schema, schemaName }, `images` = [{ base64, mediaType }]
 * (attached before the text, in order), `opts` = { effort: 'low' | 'medium', maxTokens }.
 * Returns { url, headers, body } where headers exclude the key.
 */
export function buildLlmRequest(modelKey, prompt, images = [], opts = {}) {
  const m = modelByKey(modelKey)
  if (!m) throw new Error(`Modello sconosciuto: ${modelKey}`)
  const effort = opts.effort || 'low'
  const maxTokens = opts.maxTokens || 1500
  const json = { 'Content-Type': 'application/json' }

  if (m.provider === 'anthropic') {
    // Messages API: image blocks { type: 'image', source: { type: 'base64', media_type, data } }; structured output
    // through output_config.format (json_schema, constrained decoding); effort through output_config.effort.
    // Claude Haiku 5.5: thinking is adaptive by default and its default effort is "medium", so effort is always set.
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: json,
      body: {
        model: m.model,
        max_tokens: maxTokens,
        system: prompt.system,
        messages: [{
          role: 'user',
          content: [
            ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
            { type: 'text', text: prompt.text },
          ],
        }],
        output_config: { effort, format: { type: 'json_schema', schema: prompt.schema } },
      },
    }
  }

  if (m.provider === 'openai') {
    // Responses API: instructions + input parts (input_image as a data URL with explicit detail, input_text);
    // Structured Outputs through text.format json_schema strict; reasoning.effort is always set (gpt-6-luna defaults
    // to "medium"); store:false so the response is not kept by OpenAI (abuse logs still 30 days).
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: json,
      body: {
        model: m.model,
        store: false,
        reasoning: { effort },
        max_output_tokens: maxTokens,
        instructions: prompt.system,
        input: [{
          role: 'user',
          content: [
            ...images.map((img) => ({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.base64}`, detail: 'high' })),
            { type: 'input_text', text: prompt.text },
          ],
        }],
        text: { format: { type: 'json_schema', name: prompt.schemaName || 'risposta', strict: true, schema: prompt.schema } },
      },
    }
  }

  if (m.provider === 'deepseek') {
    // Chat Completions: image parts are OpenAI-style data URLs; json_object mode (valid JSON, keys not enforced: the
    // app validates); the prompt must contain the word "json". Verification runs with thinking disabled (thinking is
    // on by default and billed as output); the explanation uses reasoning_effort "low". Images only in user messages.
    const body = {
      model: m.model,
      messages: [
        { role: 'system', content: `${prompt.system}\nRispondi solo con un oggetto json conforme a questo schema: ${JSON.stringify(prompt.schema)}` },
        {
          role: 'user',
          content: images.length
            ? [...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}`, detail: 'high' } })), { type: 'text', text: prompt.text }]
            : prompt.text,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      stream: false,
    }
    if (effort === 'low' && images.length) body.thinking = { type: 'disabled' }
    else body.reasoning_effort = 'low'
    return { url: 'https://api.deepseek.com/chat/completions', headers: json, body }
  }

  if (m.provider === 'qwen') {
    // Model Studio international, OpenAI-compatible Chat Completions (Singapore). Image parts are data URLs without
    // detail. With images json_schema silently falls back to json_object, and json_schema is not documented for the
    // Singapore region, so json_object is used everywhere (the prompt must contain "json"; the app validates).
    // JSON mode is refused while thinking is on, so enable_thinking is always false.
    return {
      url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      headers: json,
      body: {
        model: m.model,
        messages: [
          { role: 'system', content: `${prompt.system}\nRispondi solo con un oggetto json conforme a questo schema: ${JSON.stringify(prompt.schema)}` },
          {
            role: 'user',
            content: images.length
              ? [...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })), { type: 'text', text: prompt.text }]
              : prompt.text,
          },
        ],
        response_format: { type: 'json_object' },
        enable_thinking: false,
        max_completion_tokens: maxTokens,
        stream: false,
      },
    }
  }

  throw new Error(`Fornitore sconosciuto: ${m.provider}`)
}

const errorMessageOf = (json, rawText) => (json && json.error && (json.error.message || json.error.type)) || (rawText ? String(rawText).slice(0, 300) : '')

/**
 * Reads a provider response. `status` is the HTTP status, `json` the parsed body (or null), `rawText` the body text,
 * `headers` an optional Headers-like object (Qwen flags a server-timeout partial body with x-dashscope-partialresponse).
 * Returns { ok, text, finish: 'complete' | 'truncated' | 'refused' | 'filtered' | 'other', usage: { input,
 * cachedInput, output, reasoning }, error, retryable, kind: 'auth' | 'balance' | 'rate' | 'server' | 'request' | null }.
 */
export function parseLlmResponse(provider, status, json, rawText = '', headers = null) {
  const fail = (kind, retryable, error) => ({ ok: false, text: '', finish: 'other', usage: null, error, retryable, kind })
  const code = json && json.error ? `${json.error.code || ''} ${json.error.type || ''}` : ''
  const msg = errorMessageOf(json, rawText)
  if (provider === 'qwen') {
    // Model Studio: no 402; an overdue account is 400 Arrearage, a used-up free tier 403 AllocationQuota.FreeTierOnly,
    // billing stops are 429 with their own codes. A plain 429 (Throttling.*, and insufficient_quota = TPM limit here)
    // is a rate limit. Moderation (data_inspection_failed) must not be retried with the same input.
    if (/arrearage|out_of_service|freetieronly/i.test(code) || /good standing/i.test(msg)) return fail('balance', false, `Credito esaurito o account non in regola. ${msg}`.trim())
    if (status === 429 && /budgetlimitexceeded|billoverdue|commoditynotpurchased/i.test(code)) return fail('balance', false, `Tetto di spesa o fattura scaduta. ${msg}`.trim())
    if (/data_inspection_failed|datainspectionfailed/i.test(code)) return fail('request', false, `Bloccata dal filtro del fornitore. ${msg}`.trim())
  }
  if (status === 401 || status === 403) return fail('auth', false, `Chiave non valida o senza permessi (${status}). ${msg}`.trim())
  if (status === 402) return fail('balance', false, `Credito esaurito (${status}). ${msg}`.trim())
  if (status === 429) {
    // OpenAI signals an empty balance or a spend cap with 429 + a code: retrying does not help.
    if (provider === 'openai' && /credit_balance_exhausted|insufficient_quota|spend_limit_exceeded|usage_limit_exceeded/.test(code)) return fail('balance', false, `Credito esaurito o tetto di spesa raggiunto. ${msg}`.trim())
    return fail('rate', true, `Troppe richieste (${status}). ${msg}`.trim())
  }
  if (status >= 500) return fail('server', true, `Errore del fornitore (${status}). ${msg}`.trim())
  if (status < 200 || status >= 300 || !json) {
    // Anthropic returns 400 invalid_request_error for an exhausted credit balance.
    if (/credit balance|insufficient.?(balance|quota)|run out of balance/i.test(msg)) return fail('balance', false, `Credito esaurito. ${msg}`)
    return fail('request', false, `Richiesta rifiutata (${status}). ${msg}`.trim())
  }

  if (provider === 'anthropic') {
    const text = (json.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('')
    const finish = json.stop_reason === 'end_turn' ? 'complete' : json.stop_reason === 'max_tokens' ? 'truncated' : json.stop_reason === 'refusal' ? 'refused' : 'other'
    const u = json.usage || {}
    const usage = {
      input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      cachedInput: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      output: u.output_tokens || 0,
      reasoning: null,
    }
    return { ok: finish === 'complete' && Boolean(text), text, finish, usage, error: finish === 'complete' ? null : `Risposta ${finish === 'truncated' ? 'troncata' : finish === 'refused' ? 'rifiutata dal modello' : 'incompleta'}`, retryable: false, kind: null }
  }

  if (provider === 'openai') {
    // Walk output[]: reasoning items can come first; take the assistant message text (prefer phase final_answer).
    let text = ''
    let refusal = null
    const messages = (json.output || []).filter((item) => item && item.type === 'message')
    const finals = messages.filter((item) => item.phase === 'final_answer')
    for (const item of finals.length ? finals : messages) {
      for (const part of item.content || []) {
        if (part.type === 'output_text') text += part.text || ''
        else if (part.type === 'refusal') refusal = part.refusal || 'rifiuto'
      }
    }
    const reason = json.incomplete_details && json.incomplete_details.reason
    const finish = refusal ? 'refused' : json.status === 'completed' ? 'complete' : reason === 'max_output_tokens' ? 'truncated' : reason === 'content_filter' ? 'filtered' : 'other'
    const u = json.usage || {}
    const usage = {
      input: u.input_tokens || 0,
      cachedInput: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0,
      cacheWrite: (u.input_tokens_details && u.input_tokens_details.cache_write_tokens) || 0,
      output: u.output_tokens || 0, // includes reasoning tokens
      reasoning: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) ?? null,
    }
    const ok = finish === 'complete' && Boolean(text)
    const failure = json.status === 'failed' && json.error ? `Richiesta fallita: ${json.error.message || json.error.code}` : null
    return { ok, text, finish, usage, error: ok ? null : failure || (finish === 'refused' ? 'Risposta rifiutata dal modello' : finish === 'truncated' ? 'Risposta troncata' : finish === 'filtered' ? 'Bloccata dal filtro' : 'Risposta vuota o incompleta'), retryable: false, kind: null }
  }

  if (provider === 'deepseek' || provider === 'qwen') {
    const choice = json.choices && json.choices[0]
    const text = (choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '').trim()
    const reason = choice && choice.finish_reason
    const partial = provider === 'qwen' && headers && typeof headers.get === 'function' && String(headers.get('x-dashscope-partialresponse') || '').toLowerCase() === 'true'
    const finish = partial ? 'truncated' : reason === 'stop' ? 'complete' : reason === 'length' ? 'truncated' : reason === 'content_filter' ? 'filtered' : 'other'
    const u = json.usage || {}
    const cached = u.prompt_cache_hit_tokens ?? (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ?? 0
    const usage = {
      input: u.prompt_tokens || 0,
      cachedInput: cached || 0,
      output: u.completion_tokens || 0, // includes reasoning tokens
      reasoning: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) ?? null,
    }
    const retryable = !text || reason === 'insufficient_system_resource' || reason === 'aborted'
    const ok = finish === 'complete' && Boolean(text)
    return { ok, text, finish, usage, error: ok ? null : !text ? 'Risposta vuota' : `Risposta ${finish === 'truncated' ? 'troncata' : finish === 'filtered' ? 'bloccata dal filtro' : 'incompleta'}`, retryable: !ok && retryable, kind: null }
  }

  return fail('request', false, `Fornitore sconosciuto: ${provider}`)
}
