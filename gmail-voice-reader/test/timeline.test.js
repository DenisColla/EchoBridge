import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, fractionAt, indexAt } from '../src/content/timeline.js';

const seg = (n) => ({ text: 'x'.repeat(n) });
const tl = buildTimeline([seg(10), seg(30), seg(60)]); // starts at 0, 10, 40 of 100

test('timeline weights sentences by length', () => {
  assert.deepEqual(tl, { starts: [0, 10, 40], total: 100 });
  assert.equal(fractionAt(tl, 0), 0);
  assert.equal(fractionAt(tl, 1), 0.1);
  assert.equal(fractionAt(tl, 2), 0.4);
  assert.equal(fractionAt(tl, 3), 1, 'past the last sentence = end');
});

test('word boundaries move the bar inside a sentence, never past it', () => {
  assert.equal(fractionAt(tl, 1, 15), 0.25);
  assert.equal(fractionAt(tl, 1, 999), 0.4);
  assert.equal(fractionAt(tl, 0, 5), 0.05);
});

test('a point on the bar maps to the sentence under it', () => {
  assert.equal(indexAt(tl, 0), 0);
  assert.equal(indexAt(tl, 0.09), 0);
  assert.equal(indexAt(tl, 0.1), 1);
  assert.equal(indexAt(tl, 0.39), 1);
  assert.equal(indexAt(tl, 0.4), 2);
  assert.equal(indexAt(tl, 1), 2, 'the end of the bar is the last sentence');
  assert.equal(indexAt(tl, -1), 0);
  assert.equal(indexAt(tl, 2), 2);
});

test('round trip: seeking to a sentence start lands on that sentence', () => {
  for (let i = 0; i < tl.starts.length; i++) assert.equal(indexAt(tl, fractionAt(tl, i)), i);
});

test('empty queue is safe', () => {
  const empty = buildTimeline([]);
  assert.equal(fractionAt(empty, 0), 0);
  assert.equal(indexAt(empty, 0.5), 0);
});
