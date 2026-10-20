/**
 * Purpose: regress actual-image marker placement and reject clicks in letterbox/background space.
 * Setup: node --test; pure geometry fixtures, no user state or network.
 * Writes: none. Constraints: uses the same contain geometry as the square photograph frames.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {containedImageBounds, imagePointFromClient} from '../extension/lib/photo-geometry.js';

test('wide and portrait photographs retain actual coordinate systems inside square frames', () => {
  assert.deepEqual(containedImageBounds(1200, 600), {left: 0, top: .25, width: 1, height: .5});
  assert.deepEqual(containedImageBounds(600, 1200), {left: .25, top: 0, width: .5, height: 1});
  assert.deepEqual(containedImageBounds(600, 600), {left: 0, top: 0, width: 1, height: 1});
  assert.deepEqual(containedImageBounds(1200, 600, 240, 120), {left: 0, top: 0, width: 1, height: 1});
});

test('photo clicks normalize against the actual image instead of its padded frame', () => {
  const image = {left: 100, top: 150, width: 400, height: 200};
  assert.deepEqual(imagePointFromClient(300, 250, image), {x: .5, y: .5});
  assert.deepEqual(imagePointFromClient(100, 150, image), {x: 0, y: 0});
  assert.equal(imagePointFromClient(300, 100, image), null);
  assert.equal(imagePointFromClient(501, 250, image), null);
  assert.equal(containedImageBounds(0, 400), null);
  assert.equal(imagePointFromClient(0, 0, {left: 0, top: 0, width: 0, height: 1}), null);
});
