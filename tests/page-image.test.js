/**
 * Purpose: verify image-link resolution for Pinterest overlays without guessing other photos.
 * Setup: run node --test tests/page-image.test.js; fixtures provide DOM geometry and styles.
 * Destructive behavior: none; no browser, files, network requests, or page changes are made.
 * Constraints: run the serialized function without module scope, as Chrome executeScript does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {findLinkedImage} from '../extension/lib/page-image.js';

const baseUrl = 'https://www.pinterest.com/';
const pin = '/pin/123456/';
const photo = 'https://i.pinimg.com/736x/photo.jpg';

function element(tagName, options = {}, children = []) {
  const {left = 10, top = 10, width = 240, height = 320, style = {}, ...properties} = options;
  const node = {
    tagName,
    parentElement: null,
    children,
    style: {
      display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible',
      overflowX: 'visible', overflowY: 'visible', ...style,
    },
    getBoundingClientRect: () => ({left, top, width, height, right: left + width, bottom: top + height}),
    querySelectorAll(selector) {
      assert.equal(selector, 'img');
      const found = [];
      for (const child of this.children) {
        if (child.tagName === 'IMG') found.push(child);
        found.push(...child.querySelectorAll(selector));
      }
      return found;
    },
    ...properties,
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function image(options = {}) {
  return element('IMG', {
    src: photo, currentSrc: '', naturalWidth: 736, naturalHeight: 981, complete: true, ...options,
  });
}

function link(children, options = {}) {
  return element('A', {href: pin, ...options}, children);
}

function resolve(anchors, linkUrl = new URL(pin, baseUrl).href) {
  const documentElement = element('HTML', {width: 1200, height: 900}, anchors);
  return vm.runInNewContext(`(${findLinkedImage.toString()})(linkUrl)`, {
    URL,
    linkUrl,
    document: {
      baseURI: baseUrl,
      documentElement,
      querySelectorAll(selector) { assert.equal(selector, 'a[href]'); return anchors; },
    },
    window: {innerWidth: 1200, innerHeight: 900, getComputedStyle: node => node.style},
  });
}

test('a linked overlay resolves its descendant photo using the displayed srcset source', () => {
  const chosen = image({src: 'https://i.pinimg.com/236x/photo.jpg', currentSrc: photo});
  const overlay = element('DIV', {}, [element('DIV')]);
  assert.equal(resolve([link([element('DIV', {}, [chosen, overlay])])]), photo);
});

test('only the exact clicked link contributes candidates, regardless of other image size', () => {
  const unrelated = link([image({src: 'https://i.pinimg.com/unrelated.jpg', width: 900, height: 800})], {href: '/pin/other/'});
  assert.equal(resolve([unrelated, link([image()])]), photo);
  assert.equal(resolve([unrelated]), '');
});

test('resolved URLs support relative links and selector punctuation without fuzzy matching', () => {
  const href = '/pin/123456/?label=%22%5D%5Ba%5D';
  assert.equal(resolve([link([image()], {href})], new URL(href, baseUrl).href), photo);
  assert.equal(resolve([link([image()], {href})], new URL(pin, baseUrl).href), '');
});

test('unloaded, hidden, transparent, offscreen, and small image candidates are skipped', () => {
  for (const options of [
    {complete: false}, {naturalWidth: 0}, {naturalHeight: 0},
    {style: {display: 'none'}}, {style: {visibility: 'hidden'}},
    {style: {opacity: '0'}}, {style: {contentVisibility: 'hidden'}},
    {left: 1400}, {top: -500}, {width: 32, height: 32},
  ]) {
    assert.equal(resolve([link([image(options)])]), '', JSON.stringify(options));
  }
});

test('hidden and transparent ancestor containers exclude their descendant photo', () => {
  for (const style of [{display: 'none'}, {opacity: '0'}, {contentVisibility: 'hidden'}]) {
    assert.equal(resolve([link([element('DIV', {style}, [image()])])]), '');
  }
});

test('overflow clipping rejects carousel slides that remain within the browser viewport', () => {
  const visible = image();
  const clipped = image({src: 'https://i.pinimg.com/next-slide.jpg', left: 260});
  const carousel = element('DIV', {width: 240, height: 320, style: {overflowX: 'hidden', overflowY: 'hidden'}}, [visible, clipped]);
  assert.equal(resolve([link([carousel])]), photo);
});

test('clipping and viewport intersection determine visible area rather than natural resolution', () => {
  const sliver = image({src: 'https://i.pinimg.com/sliver.jpg', left: 230, width: 1000, height: 500});
  const carousel = element('DIV', {width: 240, style: {overflowX: 'clip'}}, [image(), sliver]);
  assert.equal(resolve([link([carousel])]), photo);
  assert.equal(resolve([link([image({left: 1180})])]), '');
});

test('repeated visible copies of one image URL are not treated as ambiguous', () => {
  assert.equal(resolve([link([image()]), link([image({left: 300})])]), photo);
});

test('comparable distinct images within matching links return no guessed image', () => {
  const alternate = image({src: 'https://i.pinimg.com/alternate.jpg', left: 300});
  assert.equal(resolve([link([image(), alternate])]), '');
  assert.equal(resolve([link([image()]), link([alternate])]), '');
});

test('a clear main photo remains usable beside a small accompanying thumbnail', () => {
  const thumbnail = image({src: 'https://i.pinimg.com/thumbnail.jpg', width: 80, height: 80});
  assert.equal(resolve([link([thumbnail, image()])]), photo);
});

test('unsafe or missing image sources and non-web target links yield no image', () => {
  for (const src of [undefined, '', '  ', 'javascript:alert(1)', 'file:///private/photo.png', 'blob:https://www.pinterest.com/example']) {
    assert.equal(resolve([link([image({src})])]), '');
  }
  for (const target of ['', null, 'javascript:alert(1)', 'file:///private/page.html']) {
    assert.equal(resolve([link([image()])], target), '');
  }
});

test('relative image sources resolve against the clicked document', () => {
  assert.equal(resolve([link([image({src: '/images/photo.png'})])]), 'https://www.pinterest.com/images/photo.png');
});
