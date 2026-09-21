"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { CATEGORIES, LINKEDIN_CATEGORIES, LABELS, INTENTS, displayFor, BatchClassifier } = require("../src/classification.js");
const { buildRequest, createClassifier } = require("../src/jev-client.js");

function tweet(index, extra = {}) { return { handle: `@user${index}`, content: `Tweet ${index}`, ...extra }; }
function result(category = "good_intent") {
  const categoryKeys = Object.keys(CATEGORIES);
  return { category, confidence: 0.9,
    probabilities: Object.fromEntries(categoryKeys.map((key) =>
      [key, key === category ? 0.96 : 0.04 / (categoryKeys.length - 1)])),
    intent: { value: "inform", confidence: 0.9,
      probabilities: Object.fromEntries(Object.keys(INTENTS).map((key) => [key, key === "inform" ? 0.95 : 0.01])) },
    misleadingProbability: 0.12,
    badFaithProbability: 0.03 };
}
function apiResponse(request) {
  return { model: "jev-test", answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "noul") {
      return [id, { type: "noul", noul: id.endsWith("_misleading") ? 0.12 : 0.03 }];
    }
    if (id.endsWith("_intent")) {
      return [id, { type: "choice", choice: "inform", confidence: 0.9,
        probabilities: Object.fromEntries(Object.keys(INTENTS).map((key) => [key, key === "inform" ? 0.95 : 0.01])) }];
    }
    const categoryResult = result();
    return [id, { type: "choice", choice: categoryResult.category,
      confidence: categoryResult.confidence, probabilities: categoryResult.probabilities }];
  })) };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(5); }
  assert.fail("Condition did not become true");
}

test("uses three verdict rubrics and independently addresses each tweet's context", () => {
  const request = buildRequest([tweet(1), tweet(2, { profileDescription: "Bio", citedOrRetweetedTweetContent: "Quote" })]);
  assert.equal(Object.keys(request.questions).length, 8);
  assert.deepEqual(request.questions.post_1_category.criteria, CATEGORIES);
  assert.deepEqual(request.questions.post_1_intent.criteria, INTENTS);
  assert.equal(request.questions.post_1_misleading.type, "noul");
  assert.equal(request.questions.post_1_bad_faith.type, "noul");
  assert.match(request.questions.post_0_category.instructions.join(" "), /does not by itself make a post grift/i);
  assert.match(request.questions.post_1_intent.instructions[0], /posts\[1\]/);
  assert.equal(request.state.posts[1].profileDescription, "Bio");
  assert.equal(request.state.posts[1].citedOrRetweetedTweetContent, "Quote");
});

test("uses clear display labels without changing category keys", () => {
  assert.deepEqual(Object.keys(LABELS), Object.keys(CATEGORIES));
  assert.deepEqual(Object.values(LABELS), ["Grift", "Good intent", "Unclear"]);
  assert.equal(INTENTS.push_agenda, "Primarily pushes the reader toward a belief, faction, cause, or action through forceful framing.");
  assert.equal(Object.hasOwn(INTENTS, "persuade"), false);
});

test("LinkedIn uses a substance-first rubric while X retains its original definitions", () => {
  const post = tweet(1, { content: "Leaders empower. Unlock your potential. Agree?" });
  const linkedin = buildRequest([post], "jev-latest", "linkedin");
  const x = buildRequest([post], "jev-latest", "x");
  assert.deepEqual(linkedin.questions.post_0_category.criteria, LINKEDIN_CATEGORIES);
  assert.deepEqual(x.questions.post_0_category.criteria, CATEGORIES);
  assert.deepEqual(Object.keys(LINKEDIN_CATEGORIES), Object.keys(CATEGORIES));
  assert.match(linkedin.questions.post_0_category.instructions.join(" "), /substance-first LinkedIn/);
  assert.doesNotMatch(x.questions.post_0_category.instructions.join(" "), /substance-first LinkedIn/);
  // Fluff must not redefine the independent deception-risk judgments.
  assert.deepEqual(linkedin.questions.post_0_misleading, x.questions.post_0_misleading);
  assert.deepEqual(linkedin.questions.post_0_bad_faith, x.questions.post_0_bad_faith);
});

test("identical cross-posts cannot reuse a verdict from a different platform rubric", async () => {
  const requests = [];
  const classify = createClassifier({ apiKey: "test-key", fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const response = apiResponse(request);
    if (request.questions.post_0_category.criteria.grift === LINKEDIN_CATEGORIES.grift) {
      const verdict = result("grift");
      response.answers.post_0_category = { type: "choice", choice: verdict.category,
        confidence: verdict.confidence, probabilities: verdict.probabilities };
    }
    return { ok: true, json: async () => response };
  } });
  const posts = [tweet(1)];
  assert.equal((await classify(posts, "x")).results[0].category, "good_intent");
  assert.equal((await classify(posts, "linkedin")).results[0].category, "grift");
  assert.equal((await classify(posts, "x")).results[0].category, "good_intent");
  assert.equal((await classify(posts, "linkedin")).results[0].category, "grift");
  assert.equal(requests.length, 2);
});

test("shows the primary verdict and prioritizes misleading or bad-faith risk", () => {
  const sincere = result("good_intent");
  assert.deepEqual(displayFor(sincere), { label: "Good intent", risk: "" });
  assert.deepEqual(displayFor({ ...sincere, misleadingProbability: 0.8 }),
    { label: "Good intent · misleading risk", risk: "misleading" });
  assert.deepEqual(displayFor({ ...sincere, misleadingProbability: 0.8, badFaithProbability: 0.9 }),
    { label: "Good intent · bad-faith risk", risk: "bad_faith" });
  assert.deepEqual(displayFor(result("grift")), { label: "Grift", risk: "" });
});

test("serial batches of eight, deduplication, and cached remounts", async (t) => {
  const calls = [];
  let active = 0;
  const queue = new BatchClassifier(async (tweets) => {
    assert.equal(++active, 1);
    calls.push(tweets);
    await delay(5);
    active--;
    return { results: tweets.map(() => result()) };
  }, { batchDelay: 1 });
  t.after(() => clearTimeout(queue.timer));
  const tweets = Array.from({ length: 18 }, (_, index) => tweet(index));
  queue.update([...tweets, tweets[0]]);
  queue.update(tweets);
  await until(() => tweets.every((item) => queue.get(item).status === "classified"));
  assert.deepEqual(calls.map((batch) => batch.length), [8, 8, 2]);
  queue.update([]);
  queue.update(tweets);
  await delay(10);
  assert.equal(calls.length, 3);
});

test("publishes an update only after a returned classification is available", async (t) => {
  const item = tweet(1);
  let queue;
  let observed;
  queue = new BatchClassifier(async () => ({ results: [result("grift")] }), {
    batchDelay: 1,
    onUpdate() { observed = queue.get(item); }
  });
  t.after(() => clearTimeout(queue.timer));

  queue.update([item]);
  await until(() => observed?.status === "classified");

  assert.equal(observed.category, "grift");
  assert.equal(observed.confidence, 0.9);
  assert.equal(observed.intent.value, "inform");
  assert.equal(observed.misleadingProbability, 0.12);
});

test("a late response cannot classify changed evidence; updated bio triggers reclassification", async (t) => {
  let release;
  let calls = 0;
  const original = tweet(1);
  const updated = tweet(1, { profileDescription: "New evidence" });
  const queue = new BatchClassifier(async () => {
    calls++;
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    return { results: [result(calls === 1 ? "good_intent" : "grift")] };
  }, { batchDelay: 5 });
  t.after(() => clearTimeout(queue.timer));
  queue.update([original]);
  await until(() => release);
  queue.update([updated]);
  release();
  await until(() => queue.get(original).status === "classified");
  assert.equal(queue.get(updated).category, undefined);
  await until(() => queue.get(updated).status === "classified");
  assert.equal(queue.get(updated).category, "grift");
});

test("empty content is skipped, outages stop after three retries, and manual retry recovers", async (t) => {
  let calls = 0;
  let healthy = false;
  const queue = new BatchClassifier(async () => {
    calls++;
    if (!healthy) return { error: "Classifier offline" };
    return { results: [result()] };
  }, { batchDelay: 1, retryDelay: 1 });
  t.after(() => clearTimeout(queue.timer));
  queue.update([tweet(1), { content: null }]);
  await until(() => calls === 3 && !queue.active);
  await delay(20);
  assert.equal(calls, 3);
  assert.equal(queue.get(tweet(1)).status, "error");
  assert.equal(queue.get({ content: null }).status, "unavailable");
  healthy = true;
  queue.retry();
  await until(() => queue.get(tweet(1)).status === "classified");
  assert.equal(calls, 4);
});

test("background client preserves order, deduplicates across tabs, and keeps the key in the upstream header", async () => {
  const calls = [];
  const classify = createClassifier({ apiKey: "test-secret", fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    assert.ok(!options.body.includes("test-secret"));
    calls.push(request);
    return { ok: true, json: async () => apiResponse(request) };
  } });
  const [first, second] = await Promise.all([classify([tweet(1), tweet(2), tweet(1)]), classify([tweet(2)])]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].state.posts.length, 2);
  assert.equal(first.results.length, 3);
  assert.deepEqual(first.results[1], second.results[0]);
  await classify([tweet(1, { profileDescription: "Changed" })]);
  assert.equal(calls.length, 2);
});

test("rejects oversized batches and missing/invalid answers without caching failures", async () => {
  let calls = 0;
  const classify = createClassifier({ apiKey: "test", fetchImpl: async () => {
    calls++;
    return { ok: true, json: async () => ({ answers: {} }) };
  } });
  await assert.rejects(classify(Array.from({ length: 9 }, (_, i) => tweet(i))), /Expected/);
  await assert.rejects(classify([tweet(1)]), /incomplete/);
  await assert.rejects(classify([tweet(1)]), /incomplete/);
  assert.equal(calls, 2);
});

test("does not expose upstream error bodies and can recover from rate limits", async () => {
  let limited = true;
  const classify = createClassifier({ apiKey: "test", fetchImpl: async (_, options) => limited
    ? { ok: false, status: 429, json: async () => ({ secret: "never exposed" }) }
    : { ok: true, json: async () => apiResponse(JSON.parse(options.body)) } });
  await assert.rejects(classify([tweet(1)]), { status: 429, message: "Jev returned HTTP 429. Retrying shortly." });
  limited = false;
  assert.equal((await classify([tweet(1)])).results[0].category, "good_intent");
});
