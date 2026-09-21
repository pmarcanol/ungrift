"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { anonymizedName } = require("../src/privacy.js");

test("privacy display keeps only a first name when a surname is present", () => {
  assert.equal(anonymizedName("Ada Lovelace"), "Ada •••");
  assert.equal(anonymizedName("María José García"), "María •••");
  assert.equal(anonymizedName("  Grace   Brewster Murray Hopper  "), "Grace •••");
});

test("privacy display skips honorifics when choosing the visible first name", () => {
  assert.equal(anonymizedName("Dr. Mae Jemison"), "Mae •••");
  assert.equal(anonymizedName("Professor Stephen Hawking"), "Stephen •••");
});

test("privacy display leaves mononyms unchanged", () => {
  assert.equal(anonymizedName("Madonna"), "Madonna");
  assert.equal(anonymizedName(" "), "");
});
