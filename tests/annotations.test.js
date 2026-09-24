"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const annotations = require("../src/annotations.js");
const classification = require("../src/classification.js");
const sample = { key: "123", label: "grift", note: "An income promise without evidence",
  post: { handle: "@author", content: "Earn millions", profileDescription: "Paid alpha channel", citedOrRetweetedTweetContent: "Quoted sales pitch" },
  classification: { status: "classified", model: "jev-test", category: "good_intent", confidence: .8, probabilities: { good_intent: .8, grift: .2 },
    intent: { value: "sell", confidence: .9, probabilities: { sell: .9 } }, misleadingProbability: .7, badFaithProbability: .8 } };

test("human labels retain original evidence and model disagreement without extra private fields", () => {
  const record = annotations.annotation({ ...sample, typesafeApiKey: "secret", post: { ...sample.post, cookie: "secret" } }, "x", null, "test", "2026-01-01");
  assert.equal(record.label, "grift");
  assert.equal(record.model.category, "good_intent");
  assert.equal(record.model.status, "classified");
  assert.equal(record.model.model, "jev-test");
  assert.deepEqual(record.post, sample.post);
  assert.equal(record.url, "https://x.com/i/status/123");
  assert.doesNotMatch(JSON.stringify(record), /secret|cookie|typesafeApiKey/);
  const updated = annotations.annotation({ ...sample, label: "slop" }, "x", record, "test", "2026-02-01");
  assert.equal(updated.createdAt, record.createdAt);
  assert.equal(updated.updatedAt, "2026-02-01");
  assert.equal(updated.label, "slop");
  assert.equal(annotations.dataset({ [updated.id]: updated }).annotations.length, 1);
  assert.throws(() => annotations.annotation({ ...sample, label: "good_intent" }, "x", null, "test"));
  assert.throws(() => annotations.annotation({ ...sample, note: "a".repeat(4001) }, "x", null, "test"));
  assert.equal(annotations.annotation({ ...sample, key: "linkedin:urn:li:activity:42" }, "linkedin", null, "test").url, "https://www.linkedin.com/feed/update/urn:li:activity:42/");
});

function worker() {
  let listener, fail = false;
  const storage = {};
  const context = { ready: Promise.resolve(), supportedTabUrls: [], UngriftAnnotations: annotations, UngriftClassification: classification,
    chrome: { runtime: { id: "test", getManifest: () => ({ version: "test" }), onMessage: { addListener(fn) { listener = fn; } } },
      storage: { onChanged: { addListener() {} }, local: {
        async get() { return structuredClone(storage); },
        async set(value) { await new Promise((resolve) => setImmediate(resolve)); if (fail) throw new Error("Quota exceeded"); Object.assign(storage, structuredClone(value)); }
      } }, tabs: { async query() { return []; } } }
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../src/marker-background.js`, "utf8"), context);
  return { storage, fail() { fail = true; }, message(message, url = "https://x.com/home", senderId = "test") {
    return new Promise((resolve) => { if (!listener(message, { id: senderId, url }, resolve)) resolve(undefined); });
  } };
}

test("broker serializes saves across tabs, upserts, deletes, and does not acknowledge failed writes", async () => {
  const w = worker();
  await Promise.all([w.message({ ...sample, type: "marking-save" }), w.message({ ...sample, key: "456", type: "marking-save" })]);
  assert.equal(Object.keys(w.storage.manualPostAnnotations).length, 2);
  await w.message({ ...sample, label: "value", type: "marking-save" });
  assert.equal(Object.keys(w.storage.manualPostAnnotations).length, 2);
  assert.equal(w.storage.manualPostAnnotations["x:123"].label, "value");
  assert.deepEqual(w.storage.manualPostAnnotations["x:123"].modelInput, classification.contextFor(sample.post));
  await w.message({ key: "123", type: "marking-delete" });
  assert.equal(Object.keys(w.storage.manualPostAnnotations).length, 1);
  w.fail();
  assert.ok((await w.message({ ...sample, type: "marking-save" })).error);
  assert.equal(Object.keys(w.storage.manualPostAnnotations).length, 1);
});

test("broker rejects foreign senders and derives the platform from the authorized feed", async () => {
  const w = worker();
  for (const url of ["https://x.com.evil.example/home", "https://evil.example", "chrome-extension://other/popup/index.html"]) {
    assert.equal(await w.message({ ...sample, type: "marking-save" }, url), undefined);
  }
  assert.equal(await w.message({ ...sample, type: "marking-save" }, "https://x.com/home", "other"), undefined);
  await w.message({ ...sample, platform: "x", type: "marking-save" }, "https://www.linkedin.com/feed/");
  assert.ok(w.storage.manualPostAnnotations["linkedin:123"]);
  assert.equal(w.storage.manualPostAnnotations["x:123"], undefined);
  const state = await w.message({ type: "marking-state" });
  assert.deepEqual(Object.keys(state.labels["linkedin:123"]), ["label", "note"]);
});
