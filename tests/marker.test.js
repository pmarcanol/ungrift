"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

function harness(enabled = true) {
  const { document, window } = parseHTML('<html><head></head><body><article data-ungrift-post-number="1"><p>Original text</p></article></body></html>');
  let listener;
  const messages = [];
  const sandbox = vm.createContext({ document, location: { hostname: "x.com" }, structuredClone,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } }, async sendMessage(message) {
      messages.push(structuredClone(message));
      if (message.type === "marking-state") return { enabled, labels: {} };
      return { ok: true };
    } } }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/../src/marker.js`, "utf8"), sandbox);
  const card = document.querySelector("article");
  function register(key = "123", text = "Original text") {
    sandbox.UngriftMarker.register(card, key, { content: text, handle: "@ada", profileDescription: "Engineer" }, { status: "classified", category: "good_intent", confidence: .9 });
  }
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const click = (element) => element.dispatchEvent(new window.Event("click", { bubbles: true, composed: true, cancelable: true }));
  return { document, card, register, messages, settle, click, message: (value) => listener(value), root: () => document.querySelector("#ungrift-marker")?.shadowRoot };
}

test("marking is opt-in, captures selected evidence before card recycling, and supports correction/removal", async () => {
  const h = harness(false);
  h.register(); await h.settle();
  assert.equal(h.click(h.card), true, "Normal feed clicks are untouched");
  assert.equal(h.root(), undefined);
  h.message({ type: "marking-mode", enabled: true });
  assert.equal(h.click(h.card), false, "Marking intercepts navigation and feed actions");
  const root = h.root();
  assert.equal(root.querySelector("#excerpt").textContent, "Original text");
  root.querySelector("#note").value = "Why I disagree";
  h.register("456", "Replacement virtualized post");
  h.click(root.querySelector('[data-label="grift"]')); await h.settle();
  const saved = h.messages.find((message) => message.type === "marking-save");
  assert.equal(saved.key, "123");
  assert.equal(saved.post.content, "Original text");
  assert.equal(saved.note, "Why I disagree");
  assert.equal(saved.classification.category, "good_intent");
  assert.equal(h.card.hasAttribute("data-ungrift-marked"), false, "Recycled card is not marked as the original");
  h.register(); h.click(h.card);
  assert.equal(root.querySelector('[data-label="grift"]').getAttribute("aria-pressed"), "true");
  h.click(root.querySelector('[data-label="slop"]')); await h.settle();
  assert.equal(h.card.getAttribute("data-ungrift-marked"), "slop");
  h.click(root.querySelector("#remove")); await h.settle();
  assert.equal(h.card.hasAttribute("data-ungrift-marked"), false);
  h.click(root.querySelector("#stop")); await h.settle();
  assert.equal(h.document.documentElement.classList.contains("ungrift-marking"), false);
  assert.equal(h.document.querySelector("#ungrift-marker").hidden, true);
  assert.equal(h.click(h.card), true);
});

test("existing labels restore on remount and marker UI never enters extracted post text", async () => {
  const h = harness(); h.register(); await h.settle();
  h.message({ type: "marking-labels", labels: { "x:123": { label: "value", note: "Specific evidence" } } });
  h.click(h.card);
  assert.equal(h.root().querySelector("#note").value, "Specific evidence");
  assert.equal(h.card.getAttribute("data-ungrift-marked"), "value");
  assert.equal(h.card.textContent, "Original text");
});
