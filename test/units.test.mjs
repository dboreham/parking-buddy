import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../js/units.js';
import { fmtFt } from '../js/render.js';

test('parseLength accepts decimal feet, feet and inches, and inches', () => {
  assert.equal(parseLength('9'), 9);
  assert.equal(parseLength(' 9.25 '), 9.25);
  assert.equal(parseLength(`9'6"`), 9.5);
  assert.equal(parseLength(`9' 6`), 9.5);
  assert.equal(parseLength('9 ft 6 in'), 9.5);
  assert.equal(parseLength('9ft'), 9);
  assert.equal(parseLength('114"'), 9.5);
  assert.equal(parseLength('114 in'), 9.5);
  assert.equal(parseLength('9’6”'), 9.5, 'typographic quotes');
});

test('parseLength rejects junk and negatives', () => {
  for (const s of ['', 'abc', '-3', '9..5', "9'6'", '1e3']) assert.ok(Number.isNaN(parseLength(s)), s);
});

test('fmtFt shows feet and inches', () => {
  assert.equal(fmtFt(9), `9'`);
  assert.equal(fmtFt(9.5), `9'6"`);
  assert.equal(fmtFt(15.1), `15'1"`);
  assert.equal(fmtFt(9.99), `10'`);
});
