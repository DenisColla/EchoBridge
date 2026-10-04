/**
 * Pure math helpers. No platform dependencies (works in React Native / Node / browser).
 */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const logit = (p) => Math.log(p / (1 - p))

export const sigmoid = (x) => 1 / (1 + Math.exp(-x))

/** Linear ramp: 0 at x0, 1 at x1, clamped. */
export const ramp = (x, x0, x1) => clamp((x - x0) / (x1 - x0), 0, 1)

/**
 * Piecewise-linear interpolation over sorted [x, y] points.
 * Values outside the range are clamped to the first / last y.
 */
export function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1]
  const last = points[points.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]
    if (x <= x1) {
      const [x0, y0] = points[i - 1]
      const t = (x - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return last[1]
}

/** Interpolates probability knots in logit space; returns the LOGIT. Smooth, no kinks in P space. */
export function interpolateLogit(points, x) {
  const pts = points.map(([px, py]) => [px, logit(clamp(py, 0.005, 0.995))])
  return interpolate(pts, x)
}

/** Soft squash into [3%, 97%]: monotone, never produces exact ties like a hard clamp would. */
export const squash = (l) => 0.03 + 0.94 * sigmoid(l)

/** Deterministic 32-bit FNV-1a hash of a string. */
export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const roundTo = (value, step = 1) => Math.round(value / step) * step

export const toPercent = (p) => Math.round(p * 100)

/** "+5", "−5" (typographic minus) or "±0". */
export const formatSignedPoints = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0')

/** "+5 punti", "−1 punto", "±0 punti". */
export const formatPoints = (n) => `${formatSignedPoints(n)} ${Math.abs(n) === 1 ? 'punto' : 'punti'}`
