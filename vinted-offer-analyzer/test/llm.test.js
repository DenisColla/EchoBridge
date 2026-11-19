import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LLM_MODELS, VERIFY_SCHEMA, authHeaders, buildLlmRequest, deepseekPeakAt, estimateCallCost, llmCost, modelByKey, parseLlmResponse,
  readModelJson, verifyPrompt,
} from '../src/core/index.js'

const img = { base64: 'QUJD', mediaType: 'image/jpeg' }
const pair = { id: 'p', source: { title: 'A', price: 10 }, candidate: { title: 'B', price: 8 } }
const prompt = verifyPrompt(pair)
const answer = JSON.stringify({ verdict: 'same', confidence: 0.9, differences: [], candidateCondition: 'buone', redFlags: [], reason: 'uguale' })

test('llm: the four models under test are registered with list prices', () => {
  assert.deepEqual(LLM_MODELS.map((m) => m.model), ['claude-haiku-5-5', 'gpt-6-luna', 'deepseek-flash', 'qwen3.8-flash'])
  for (const m of LLM_MODELS) assert.ok(m.pricing.input > 0 && m.pricing.output > 0 && m.priceNote, m.key)
  assert.equal(modelByKey('nope'), null)
})

test('llm: Anthropic request — base64 image blocks before the text, json_schema output and explicit effort', () => {
  const r = buildLlmRequest('anthropic:claude-haiku-5-5', prompt, [img, img], { effort: 'low', maxTokens: 1500 })
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(r.body.model, 'claude-haiku-5-5')
  assert.equal(r.body.max_tokens, 1500)
  assert.equal(r.body.system, prompt.system)
  const content = r.body.messages[0].content
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
  assert.equal(content[2].type, 'text')
  assert.deepEqual(r.body.output_config, { effort: 'low', format: { type: 'json_schema', schema: VERIFY_SCHEMA } })
  assert.deepEqual(authHeaders('anthropic', 'k'), { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
  assert.ok(!('thinking' in r.body), 'Haiku 5.5 thinking stays adaptive; depth is set by effort')
})

test('llm: OpenAI request — Responses API, data-URL images with detail, strict json_schema, store:false', () => {
  const r = buildLlmRequest('openai:gpt-6-luna', prompt, [img], { effort: 'low', maxTokens: 4000 })
  assert.equal(r.url, 'https://api.openai.com/v1/responses')
  assert.equal(r.body.store, false)
  assert.deepEqual(r.body.reasoning, { effort: 'low' })
  assert.equal(r.body.max_output_tokens, 4000)
  assert.equal(r.body.instructions, prompt.system)
  assert.deepEqual(r.body.input[0].content[0], { type: 'input_image', image_url: 'data:image/jpeg;base64,QUJD', detail: 'high' })
  assert.equal(r.body.input[0].content[1].type, 'input_text')
  assert.deepEqual(r.body.text.format, { type: 'json_schema', name: 'verifica_annuncio', strict: true, schema: VERIFY_SCHEMA })
  assert.deepEqual(authHeaders('openai', 'k'), { Authorization: 'Bearer k' })
})

test('llm: DeepSeek request — json_object, the word json in the prompt, thinking off for photos, low reasoning for text', () => {
  const r = buildLlmRequest('deepseek:deepseek-flash', prompt, [img], { effort: 'low' })
  assert.equal(r.url, 'https://api.deepseek.com/chat/completions')
  assert.deepEqual(r.body.response_format, { type: 'json_object' })
  assert.match(r.body.messages[0].content, /json/)
  assert.deepEqual(r.body.messages[1].content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD', detail: 'high' } })
  assert.deepEqual(r.body.thinking, { type: 'disabled' })
  assert.ok(!('reasoning_effort' in r.body), 'never both thinking:disabled and an effort')
  const text = buildLlmRequest('deepseek:deepseek-flash', prompt, [], { effort: 'medium' })
  assert.equal(text.body.reasoning_effort, 'low')
  assert.ok(!('thinking' in text.body))
  assert.equal(typeof text.body.messages[1].content, 'string')
})

test('llm: Qwen request — Singapore endpoint, json_object, thinking always off, max_completion_tokens, no image detail', () => {
  for (const effort of ['low', 'medium']) {
    const r = buildLlmRequest('qwen:qwen3.8-flash', prompt, effort === 'low' ? [img] : [], { effort, maxTokens: 900 })
    assert.equal(r.url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions')
    assert.equal(r.body.model, 'qwen3.8-flash')
    assert.deepEqual(r.body.response_format, { type: 'json_object' })
    assert.equal(r.body.enable_thinking, false, 'json mode is refused while thinking is on')
    assert.equal(r.body.max_completion_tokens, 900)
    assert.equal(r.body.max_tokens, undefined)
    assert.match(r.body.messages[0].content, /json/)
  }
  const parts = buildLlmRequest('qwen:qwen3.8-flash', prompt, [img]).body.messages[1].content
  assert.deepEqual(parts[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } })
  assert.equal(parts[1].type, 'text')
})

test('llm: Qwen responses — cached tokens billed at full price, partial-response header means truncated, own error codes', () => {
  const body = { choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 1500, prompt_tokens_details: { cached_tokens: 500 }, completion_tokens: 150 } }
  const q = parseLlmResponse('qwen', 200, body)
  assert.equal(q.ok, true)
  assert.deepEqual(q.usage, { input: 1500, cachedInput: 500, output: 150, reasoning: null })
  assert.ok(Math.abs(llmCost('qwen:qwen3.8-flash', q.usage) - (1500 * 0.15 + 150 * 0.47) / 1e6) < 1e-12)
  const partial = parseLlmResponse('qwen', 200, body, '', { get: (h) => (h === 'x-dashscope-partialresponse' ? 'true' : null) })
  assert.equal(partial.ok, false)
  assert.equal(partial.finish, 'truncated')
  const err = (status, code, message = 'x', type = 'invalid_request_error') => parseLlmResponse('qwen', status, { error: { message, type, param: null, code }, request_id: 'r' })
  assert.equal(err(401, 'invalid_api_key').kind, 'auth')
  assert.equal(err(400, 'Arrearage', 'Access denied, please make sure your account is in good standing.').kind, 'balance')
  assert.equal(err(403, 'AllocationQuota.FreeTierOnly').kind, 'balance')
  assert.equal(err(429, 'BudgetLimitExceeded').retryable, false)
  const tpm = err(429, 'insufficient_quota', 'Requests rate limit exceeded', 'insufficient_quota')
  assert.equal(tpm.kind, 'rate', 'on Model Studio insufficient_quota is a TPM limit, not billing')
  assert.equal(tpm.retryable, true)
  const mod = err(400, 'data_inspection_failed')
  assert.equal(mod.retryable, false)
  assert.match(mod.error, /filtro/)
})

test('llm: responses are read per provider, with usage normalised and truncation/refusal detected', () => {
  const a = parseLlmResponse('anthropic', 200, { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: answer }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0 } })
  assert.equal(a.ok, true)
  assert.equal(readModelJson(a.text, VERIFY_SCHEMA).ok, true)
  assert.deepEqual(a.usage, { input: 2000, cachedInput: 0, cacheWrite: 0, output: 300, reasoning: null })
  assert.equal(parseLlmResponse('anthropic', 200, { content: [{ type: 'text', text: '{"verd' }], stop_reason: 'max_tokens', usage: {} }).finish, 'truncated')
  assert.equal(parseLlmResponse('anthropic', 200, { content: [], stop_reason: 'refusal', usage: {} }).finish, 'refused')

  const o = parseLlmResponse('openai', 200, {
    status: 'completed',
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] }],
    usage: { input_tokens: 2100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1100 }, output_tokens: 700, output_tokens_details: { reasoning_tokens: 450 } },
  })
  assert.equal(o.ok, true)
  assert.equal(o.text, answer)
  assert.deepEqual(o.usage, { input: 2100, cachedInput: 0, cacheWrite: 1100, output: 700, reasoning: 450 })
  assert.equal(parseLlmResponse('openai', 200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: {} }).finish, 'truncated')
  assert.equal(parseLlmResponse('openai', 200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage: {} }).finish, 'refused')

  const d = parseLlmResponse('deepseek', 200, { choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 1300, prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 1000, completion_tokens: 200 } })
  assert.equal(d.ok, true)
  assert.deepEqual(d.usage, { input: 1300, cachedInput: 300, output: 200, reasoning: null })
  const empty = parseLlmResponse('deepseek', 200, { choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: {} })
  assert.equal(empty.ok, false)
  assert.equal(empty.retryable, true, 'DeepSeek json mode may return empty content: retry once')
})

test('llm: HTTP errors are classified so the app stops on bad keys and empty balances and retries the rest', () => {
  assert.equal(parseLlmResponse('openai', 401, { error: { message: 'Incorrect API key', code: 'invalid_api_key' } }).kind, 'auth')
  assert.equal(parseLlmResponse('deepseek', 402, { error: { message: 'Insufficient Balance' } }).kind, 'balance')
  const quota = parseLlmResponse('openai', 429, { error: { message: 'You exceeded your quota', type: 'insufficient_quota', code: 'credit_balance_exhausted' } })
  assert.equal(quota.kind, 'balance')
  assert.equal(quota.retryable, false)
  const rate = parseLlmResponse('openai', 429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } })
  assert.equal(rate.kind, 'rate')
  assert.equal(rate.retryable, true)
  assert.equal(parseLlmResponse('anthropic', 529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }).retryable, true)
  assert.equal(parseLlmResponse('anthropic', 400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }).kind, 'balance')
  assert.equal(parseLlmResponse('deepseek', 401, null, 'Authentication Fails (governor)').kind, 'auth', 'plain-text error bodies are handled')
})

test('llm: costs follow list prices, cache reads/writes and DeepSeek peak hours', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`)
  near(llmCost('anthropic:claude-haiku-5-5', { input: 2000, cachedInput: 0, output: 300 }), (2000 * 0.10 + 300 * 0.50) / 1e6)
  near(llmCost('openai:gpt-6-luna', { input: 2100, cachedInput: 0, cacheWrite: 1100, output: 700 }), (1000 * 0.10 + 1100 * 0.125 + 700 * 0.50) / 1e6)
  const peak = new Date('2026-10-12T07:30:00Z') // Monday 07:30 UTC
  const offPeak = new Date('2026-10-11T07:30:00Z') // Sunday
  assert.equal(deepseekPeakAt(peak), true)
  assert.equal(deepseekPeakAt(offPeak), false)
  assert.equal(deepseekPeakAt(new Date('2026-10-12T04:00:00Z')), false)
  near(llmCost('deepseek:deepseek-flash', { input: 1300, cachedInput: 300, output: 200 }, peak), (1000 * 0.30 + 300 * 0.006 + 200 * 1.20) / 1e6)
  near(llmCost('deepseek:deepseek-flash', { input: 1300, cachedInput: 300, output: 200 }, offPeak), (1000 * 0.15 + 300 * 0.003 + 200 * 0.60) / 1e6)
  assert.ok(estimateCallCost('anthropic:claude-haiku-5-5', 'verify') < 0.001)
  assert.equal(llmCost('nope', { input: 1 }), null)
})
