"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const classification = require("../src/classification.js");

function worker(storage) {
  let listener;
  let onChanged;
  const queries = [];
  const sent = [];
  const batches = [];
  const sandbox = {
    importScripts() {},
    UngriftClassification: classification,
    UngriftJev: { createClassifier({ apiKey }) {
      assert.equal(apiKey, "test-key");
      return async (posts, platform) => { batches.push({ posts, platform }); return { results: [] }; };
    } },
    chrome: {
      runtime: { id: "ungrift", getURL: (path) => `chrome-extension://ungrift/${path}`,
        onMessage: { addListener(fn) { listener = fn; } } },
      storage: {
        local: { async setAccessLevel() {}, async get() { return storage; } },
        onChanged: { addListener(fn) { onChanged = fn; } }
      },
      tabs: {
        async query(options) { queries.push(options); return [{ id: 1 }, { id: 2 }]; },
        async sendMessage(id, message) { sent.push({ id, message }); }
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../src/background.js`, "utf8"), sandbox);
  return { queries, sent, batches, onChanged,
    message(message, url, id = "ungrift") {
      return new Promise((resolve) => {
        if (!listener(message, { id, url }, resolve)) resolve(undefined);
      });
    } };
}

test("X and LinkedIn use the same background authorization, stored filters, and classification broker", async () => {
  const state = { typesafeApiKey: "test-key", hiddenTweetCategories: ["grift"] };
  const background = worker(state);
  for (const url of ["https://x.com/home", "https://twitter.com/home", "https://www.linkedin.com/feed/"]) {
    assert.deepEqual(Array.from((await background.message({ type: "get-hidden-post-categories" }, url)).categories), ["grift"]);
    await background.message({ type: "classify-posts", posts: [{ content: "Evidence" }] }, url);
  }
  assert.equal(background.batches.length, 3);
  assert.deepEqual(background.batches.map((batch) => batch.platform), ["x", "x", "linkedin"]);
  await background.message({ type: "classify-posts", platform: "linkedin", posts: [{ content: "Evidence" }] }, "https://x.com/home");
  assert.equal(background.batches.at(-1).platform, "x", "The sender URL, not page-supplied data, selects the rubric");
  state.hiddenPostCategories = [];
  assert.equal((await background.message({ type: "get-hidden-post-categories" }, "https://www.linkedin.com/feed/")).categories.length, 0);
  for (const url of ["https://www.linkedin.com.evil.example/feed/", "https://other.example/"]) {
    assert.equal(await background.message({ type: "classify-posts", posts: [{ content: "Evidence" }] }, url), undefined);
  }
  assert.equal(background.batches.length, 4);
});

test("filters and retries broadcast to both platforms", async () => {
  const background = worker({});
  background.onChanged({ hiddenPostCategories: { newValue: ["grift"] } }, "local");
  await background.message({ type: "retry-classification" }, "chrome-extension://ungrift/popup/index.html");
  assert.equal(background.queries.length, 2);
  for (const query of background.queries) {
    assert.ok(query.url.includes("https://x.com/*"));
    assert.ok(query.url.includes("https://www.linkedin.com/*"));
  }
  assert.equal(background.sent.filter(({ message }) => message.type === "apply-hidden-post-categories").length, 2);
  assert.equal(background.sent.filter(({ message }) => message.type === "retry-classification").length, 2);
});
