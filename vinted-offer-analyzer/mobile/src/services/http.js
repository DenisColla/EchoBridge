/**
 * One HTTP request that needs no timer of the app (1.18).
 *
 * React Native's `fetch` hands its answer over with a zero-delay timer, and the app's timers are driven by the
 * screen's frames: with the app behind or the screen off they may not fire, and a `fetch` made from a background
 * task would then never answer. XMLHttpRequest calls back straight from the network layer, and its `timeout` is
 * enforced there too.
 *
 * → { ok, status, text, header(name) } when the server answered (ok: 2xx), or
 *   { ok: false, status: 0, text: null, error: 'timeout' | 'network' | 'cancelled' }. Never throws.
 */
export function xhrRequest({ method = 'GET', url, headers = {}, body = null, timeoutMs = 25_000, signal = null }) {
  return new Promise((resolve) => {
    let settled = false
    let onAbort = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const failed = (error) => finish({ ok: false, status: 0, text: null, error, header: () => null })
    try {
      if (signal && signal.aborted) { failed('cancelled'); return }
      const xhr = new XMLHttpRequest()
      xhr.open(method, url, true)
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, String(value))
      xhr.timeout = timeoutMs
      xhr.onload = () => finish({
        ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: typeof xhr.responseText === 'string' ? xhr.responseText : '',
        header: (name) => { try { return xhr.getResponseHeader(name) } catch { return null } },
      })
      xhr.onerror = () => failed('network')
      xhr.ontimeout = () => failed('timeout')
      xhr.onabort = () => failed('cancelled')
      if (signal) {
        onAbort = () => { try { xhr.abort() } catch { failed('cancelled') } }
        signal.addEventListener('abort', onAbort)
      }
      xhr.send(body)
    } catch {
      failed('network')
    }
  })
}
