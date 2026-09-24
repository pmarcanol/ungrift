"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { CATEGORIES, INTENTS } = require("../src/classification.js");

const variants = [
  { name: "X", hostname: "x.com", card: 'article', body: '[data-testid="tweetText"]',
    markup: `<article data-testid="tweet"><div data-testid="User-Name"><a href="/ada">@ada</a></div>
      <a href="/ada/status/100"><time>Now</time></a><div data-testid="tweetText">Original contribution.</div></article>` },
  { name: "LinkedIn classic", hostname: "www.linkedin.com", card: '.feed-shared-update-v2', body: '.update-components-text',
    markup: `<div id="site-owned-id" class="feed-shared-update-v2" data-id="urn:li:activity:100">
      <div class="update-components-actor__name">Ada Lovelace</div>
      <div class="update-components-text">Original contribution.</div></div>` },
  { name: "LinkedIn semantic", hostname: "www.linkedin.com", card: '[role="listitem"]', body: 'p',
    markup: `<div role="listitem" data-id="urn:li:activity:100">
      <div><a href="/in/ada">Ada Lovelace</a></div><p dir="ltr">Original contribution.</p>
      <button aria-label="Comment on this post">Comment</button></div>` },
  { name: "LinkedIn SDUI", hostname: "www.linkedin.com", card: '[role="listitem"]', body: '[data-testid="expandable-text-box"]',
    markup: `<div role="list" data-testid="mainFeed" data-component-type="LazyColumn">
      <div role="listitem" componentkey="update-card-focus100"><div><div>
        <a href="/in/ada"><p>Ada Lovelace</p><p> • 2nd</p></a></div><p>Software engineer</p></div>
        <p><span data-testid="expandable-text-box">Original contribution.</span></p>
        <button aria-label="Reaction button state: no reaction">Like</button></div></div>` }
];

function result(category = "grift") {
  const distribution = (keys, chosen) => Object.fromEntries(keys.map((key) => [key, key === chosen ? 1 : 0]));
  return { category, confidence: 1, probabilities: distribution(Object.keys(CATEGORIES), category),
    intent: { value: "inform", confidence: 1, probabilities: distribution(Object.keys(INTENTS), "inform") },
    misleadingProbability: 0.8, badFaithProbability: 0.1 };
}

function harness(t, variant, respond = (posts) => ({ results: posts.map(() => result()) }), hidden = []) {
  const { document, window } = parseHTML(`<!doctype html><html><head></head><body><main>${variant.markup}</main></body></html>`);
  const timers = new Map();
  const observers = [];
  const calls = [];
  let now = 0;
  let nextTimer = 1;
  let messageListener;
  const sandbox = vm.createContext({
    document, window, location: { hostname: variant.hostname, origin: `https://${variant.hostname}` },
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay = 0) { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class extends window.MutationObserver {
      constructor(fn) { super(fn); observers.push(this); }
    },
    chrome: { runtime: {
      onMessage: { addListener(fn) { messageListener = fn; } },
      async sendMessage(message) {
        if (message.type === "get-hidden-post-categories") return { categories: hidden };
        assert.equal(message.type, "classify-posts");
        const posts = JSON.parse(JSON.stringify(message.posts));
        calls.push(posts);
        return respond(posts);
      }
    } }
  });
  for (const file of ["classification.js", "linkedin-data.js", "content.js"]) {
    vm.runInContext(fs.readFileSync(`${__dirname}/../src/${file}`, "utf8"), sandbox, { filename: file });
  }
  t.after(() => { observers.forEach((observer) => observer.disconnect()); timers.clear(); });
  async function settle() {
    for (let i = 0; i < 100; i++) {
      // Flush both classification promises and real DOM mutation callbacks.
      for (let j = 0; j < 6; j++) await Promise.resolve();
      if (!timers.size) return;
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(id);
      now = timer.at;
      timer.fn();
    }
    assert.fail("Feed did not settle: annotation or extraction caused a refresh loop");
  }
  return { document, calls, settle, message: (message) => messageListener(message),
    refresh: () => document.dispatchEvent(new window.Event("visibilitychange")) };
}

for (const variant of variants) {
  test(`${variant.name}: one classification, one badge, hide/show, cached remount, changed text`, async (t) => {
    const feed = harness(t, variant);
    await feed.settle();
    let card = feed.document.querySelector(variant.card);
    const number = card.dataset.ungriftPostNumber;
    assert.equal(feed.calls.length, 1);
    assert.equal(feed.calls[0][0].content, "Original contribution.");
    assert.equal(card.querySelectorAll(".ungrift-label").length, 1);
    assert.equal(card.querySelector(".ungrift-label").textContent, "Grift · misleading risk");
    if (variant.name === "LinkedIn classic") assert.equal(card.id, "site-owned-id");
    if (variant.name === "LinkedIn SDUI") {
      const badge = card.querySelector(".ungrift-label");
      assert.ok(badge.parentElement.classList.contains("ungrift-linkedin-author"));
      assert.equal(badge.previousElementSibling.tagName, "A");
    }

    for (let i = 0; i < 3; i++) {
      feed.refresh();
      await feed.settle();
    }
    assert.equal(feed.calls.length, 1, "Our annotations must not change evidence");
    feed.message({ type: "apply-hidden-post-categories", categories: ["grift"] });
    await feed.settle();
    assert.equal(card.classList.contains("ungrift-category-hidden"), true);
    feed.message({ type: "apply-hidden-post-categories", categories: [] });
    await feed.settle();
    assert.equal(card.classList.contains("ungrift-category-hidden"), false);
    assert.equal(feed.calls.length, 1);

    feed.document.querySelector("main").innerHTML = variant.markup;
    await feed.settle();
    card = feed.document.querySelector(variant.card);
    assert.equal(card.dataset.ungriftPostNumber, number);
    assert.equal(feed.calls.length, 1, "Remounts reuse cached evidence");

    card.querySelector(variant.body).textContent = "Edited contribution.";
    await feed.settle();
    assert.equal(feed.calls.length, 2);
    assert.equal(feed.calls[1][0].content, "Edited contribution.");
    assert.equal(card.dataset.ungriftPostNumber, number);
    assert.equal(card.querySelectorAll(".ungrift-label").length, 1);
  });

  test(`${variant.name}: pending/error posts stay visible and retry recovers`, async (t) => {
    let healthy = false;
    const feed = harness(t, variant, (posts) => healthy
      ? { results: posts.map(() => result()) } : { error: "Offline" }, ["grift"]);
    await feed.settle();
    const card = feed.document.querySelector(variant.card);
    assert.equal(feed.calls.length, 3);
    assert.equal(card.querySelector(".ungrift-label").textContent, "Classifier offline");
    assert.equal(card.classList.contains("ungrift-category-hidden"), false);
    healthy = true;
    feed.message({ type: "retry-classification" });
    await feed.settle();
    assert.equal(feed.calls.length, 4);
    assert.equal(card.classList.contains("ungrift-category-hidden"), true);
  });

  test(`${variant.name}: empty posts are unavailable; late answers cannot classify new text`, async (t) => {
    const empty = { ...variant, markup: variant.markup.replace("Original contribution.", "") };
    const unavailable = harness(t, empty);
    await unavailable.settle();
    assert.equal(unavailable.calls.length, 0);
    assert.equal(unavailable.document.querySelector(".ungrift-label").textContent, "No text");

    const pending = [];
    const feed = harness(t, variant, () => new Promise((resolve) => pending.push(resolve)), ["grift"]);
    await feed.settle();
    const card = feed.document.querySelector(variant.card);
    assert.equal(card.querySelector(".ungrift-label").textContent, "Classifying…");
    assert.equal(card.classList.contains("ungrift-category-hidden"), false);
    card.querySelector(variant.body).textContent = "Updated while waiting.";
    await feed.settle();
    pending.shift()({ results: [result("grift")] });
    await feed.settle();
    assert.equal(card.classList.contains("ungrift-category-hidden"), false);
    assert.equal(card.querySelector(".ungrift-label").textContent, "Classifying…");
    pending.shift()({ results: [result("good_intent")] });
    await feed.settle();
    assert.equal(card.dataset.ungriftCategory, "good_intent");
  });

  test(`${variant.name}: recycled card identity changes without duplicate badges or requests`, async (t) => {
    const feed = harness(t, variant);
    await feed.settle();
    const card = feed.document.querySelector(variant.card);
    const firstNumber = card.dataset.ungriftPostNumber;
    if (variant.name === "X") card.querySelector('a:has(time)').setAttribute("href", "/ada/status/200");
    else if (variant.name === "LinkedIn SDUI") card.setAttribute("componentkey", "update-card-focus200");
    else card.setAttribute("data-id", "urn:li:activity:200");
    await feed.settle();
    assert.notEqual(card.dataset.ungriftPostNumber, firstNumber);
    assert.equal(card.querySelectorAll(".ungrift-label").length, 1);
    assert.equal(feed.calls.length, 1, "Identical evidence can reuse its verdict under a new ID");
  });
}

test("a low-confidence verdict has no label and cannot hide its post", async (t) => {
  const lowConfidence = { ...result("grift"), confidence: 0.64 };
  const feed = harness(t, variants[0], (posts) => ({ results: posts.map(() => lowConfidence) }), ["grift"]);
  await feed.settle();
  const card = feed.document.querySelector("article");
  const badge = card.querySelector(".ungrift-label");
  assert.equal(badge.hidden, true);
  assert.equal(badge.textContent, "");
  assert.equal(badge.hasAttribute("aria-label"), false);
  assert.equal(card.classList.contains("ungrift-category-hidden"), false);
  assert.equal(card.hasAttribute("data-ungrift-category"), false);
});

for (const commentary of ["I disagree with this claim.", ""]) {
  test(`LinkedIn shared post ${commentary ? "with commentary" : "without commentary"}: correct evidence, badge owner, and quote edits`, async (t) => {
    const feed = harness(t, { hostname: "www.linkedin.com", markup: `
      <div class="feed-shared-update-v2" data-id="urn:li:activity:500">
        <div class="update-components-actor__name" data-author="sharer">Sharer</div>
        <div class="update-components-actor__description">Sharer bio</div>
        <div class="feed-shared-update-v2__description">${commentary}
          <div class="feed-shared-update-v2__reshared-content">
            <div class="update-components-mini-update-v2" data-id="urn:li:activity:501">
              <div class="update-components-actor__name" data-author="original">Original</div>
              <div class="update-components-actor__description">Original bio</div>
              <div class="update-components-text" data-original-text>Original words.</div>
            </div>
          </div>
        </div>
      </div>` });
    await feed.settle();
    assert.equal(feed.calls.length, 1);
    assert.equal(feed.calls[0].length, 1, "The embedded original is context, not a second feed card");
    assert.deepEqual(feed.calls[0][0], {
      handle: commentary ? "Sharer" : "Original",
      content: commentary || "Original words.",
      profileDescription: commentary ? "Sharer bio" : "Original bio",
      citedOrRetweetedTweetContent: "Original words."
    });
    const card = feed.document.querySelector('.feed-shared-update-v2');
    const number = card.dataset.ungriftPostNumber;
    const badge = card.querySelector('.ungrift-label');
    assert.equal(card.querySelectorAll('.ungrift-label').length, 1);
    assert.equal(badge.previousElementSibling.dataset.author, commentary ? "sharer" : "original");

    feed.refresh();
    await feed.settle();
    assert.equal(feed.calls.length, 1);
    card.querySelector('[data-original-text]').textContent = "Expanded original words.";
    await feed.settle();
    assert.equal(feed.calls.length, 2);
    assert.equal(feed.calls[1][0].content, commentary || "Expanded original words.");
    assert.equal(feed.calls[1][0].citedOrRetweetedTweetContent, "Expanded original words.");
    assert.equal(card.dataset.ungriftPostNumber, number);
    assert.equal(card.querySelectorAll('.ungrift-label').length, 1);
  });
}
