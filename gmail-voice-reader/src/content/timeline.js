// Maps between queue positions and a 0..1 timeline. Segments are weighted by
// text length, so the bar moves roughly with speaking time instead of jumping
// by sentence count. Pure functions: unit-tested in Node.

export function buildTimeline(segments) {
  const starts = [];
  let total = 0;
  for (const s of segments) {
    starts.push(total);
    total += Math.max(1, s.text.length);
  }
  return { starts, total };
}

// `charIndex` (from SpeechSynthesisUtterance boundary events, when the voice
// reports them) moves the position inside the current sentence.
export function fractionAt(tl, index, charIndex = 0) {
  if (!tl.total || (index <= 0 && !charIndex)) return 0;
  if (index >= tl.starts.length) return 1;
  const length = (tl.starts[index + 1] ?? tl.total) - tl.starts[index];
  return (tl.starts[index] + Math.min(Math.max(0, charIndex), length)) / tl.total;
}

// Segment under a point of the bar: the last one starting at or before it.
export function indexAt(tl, fraction) {
  const n = tl.starts.length;
  if (!n) return 0;
  const pos = Math.min(Math.max(0, fraction), 1) * tl.total;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
