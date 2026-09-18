(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UngriftClassification = api;
})(globalThis, function () {
  "use strict";

  const CATEGORIES = Object.freeze({
    grift: "The post appears designed primarily to extract attention, status, money, followers, or influence through manipulation, outrage, opportunism, or misleading presentation rather than sincere contribution.",
    good_intent: "The post appears primarily intended to inform, help, discuss, make a sincere case, entertain honestly, or share a viewpoint without using manipulative or deceptive tactics for personal gain.",
    unclear: "The supplied text is insufficient, mixed, mostly context-free, or plausibly fits both alternatives, so intent cannot be assessed responsibly."
  });
  const LABELS = Object.freeze({
    grift: "Grift",
    good_intent: "Good intent",
    unclear: "Unclear"
  });
  const INTENTS = Object.freeze({
    inform: "Primarily shares information, evidence, explanation, or useful context.",
    push_agenda: "Primarily pushes the reader toward a belief, faction, cause, or action through forceful framing.",
    provoke: "Primarily tries to trigger outrage, conflict, alarm, or a strong emotional reaction.",
    promote: "Primarily tries to gain attention, followers, sales, donations, or another personal benefit.",
    entertain: "Primarily jokes, performs, tells a story, or entertains rather than making a serious claim.",
    unclear: "The available text does not support a reliable inference about its communicative aim."
  });
  const INTENT_LABELS = Object.freeze({
    inform: "inform",
    push_agenda: "push an agenda",
    provoke: "provoke",
    promote: "promote",
    entertain: "entertain",
    unclear: "unclear intent"
  });
  const MISLEADING_THRESHOLD = 0.65;
  const BAD_FAITH_THRESHOLD = 0.7;
  const BATCH_SIZE = 8;
  const MAX_CACHE = 2000;

  function contextFor(tweet) {
    const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) || null : null;
    return {
      handle: text(tweet.handle, 100),
      content: text(tweet.content, 6000),
      profileDescription: text(tweet.profileDescription, 1600),
      citedOrRetweetedTweetContent: text(tweet.citedOrRetweetedTweetContent, 6000)
    };
  }

  function fingerprint(tweet) { return JSON.stringify(contextFor(tweet)); }

  function validResult(result) {
    const probability = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
    const distribution = (values, keys) => keys.every((key) => probability(values?.[key])) &&
      Math.abs(keys.reduce((sum, key) => sum + values[key], 0) - 1) < 0.02;
    return result && Object.hasOwn(CATEGORIES, result.category) && probability(result.confidence) &&
      distribution(result.probabilities, Object.keys(CATEGORIES)) &&
      Object.hasOwn(INTENTS, result.intent?.value) && probability(result.intent?.confidence) &&
      distribution(result.intent?.probabilities, Object.keys(INTENTS)) &&
      probability(result.misleadingProbability) && probability(result.badFaithProbability);
  }

  function displayFor(result) {
    if (!result || !Object.hasOwn(LABELS, result.category)) return null;
    const badFaithRisk = result.badFaithProbability >= BAD_FAITH_THRESHOLD;
    const misleadingRisk = result.misleadingProbability >= MISLEADING_THRESHOLD;
    const risk = badFaithRisk ? "bad_faith" : misleadingRisk ? "misleading" : "";
    const suffix = badFaithRisk ? "bad-faith risk" : misleadingRisk ? "misleading risk" : null;
    return { label: suffix ? `${LABELS[result.category]} · ${suffix}` : LABELS[result.category], risk };
  }

  // One active batch; fingerprints keep late answers away from changed/recycled cards.
  class BatchClassifier {
    constructor(send, { onUpdate = () => {}, batchDelay = 650, retryDelay = 30000 } = {}) {
      Object.assign(this, { send, onUpdate, batchDelay, retryDelay });
      this.visible = new Map();
      this.cache = new Map();
      this.failures = new Map();
      this.active = false;
      this.nextAttemptAt = 0;
    }

    get(tweet) {
      if (!contextFor(tweet).content) return { status: "unavailable" };
      const key = fingerprint(tweet);
      return this.cache.get(key) || (this.failures.has(key)
        ? { status: "error", error: this.failures.get(key).error }
        : { status: "pending" });
    }

    update(tweets) {
      this.visible = new Map(tweets.filter((tweet) => contextFor(tweet).content)
        .map((tweet) => [fingerprint(tweet), contextFor(tweet)]));
      this.schedule();
    }

    schedule() {
      if (this.active || this.timer || ![...this.visible.keys()].some((key) =>
        !this.cache.has(key) && (this.failures.get(key)?.attempts || 0) < 3)) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.run();
      }, Math.max(this.batchDelay, this.nextAttemptAt - Date.now()));
    }

    async run() {
      const batch = [...this.visible].filter(([key]) => !this.cache.has(key) &&
        (this.failures.get(key)?.attempts || 0) < 3).slice(0, BATCH_SIZE);
      if (!batch.length) return;
      this.active = true;
      try {
        const response = await this.send(batch.map(([, tweet]) => tweet));
        if (!Array.isArray(response?.results) || response.results.length !== batch.length ||
            !response.results.every(validResult)) throw new Error(response?.error || "Invalid classifier response.");
        batch.forEach(([key], index) => {
          this.cache.set(key, { status: "classified", ...response.results[index] });
          this.failures.delete(key);
        });
        this.nextAttemptAt = 0;
        while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
      } catch (error) {
        let attempts = 1;
        for (const [key] of batch) {
          attempts = (this.failures.get(key)?.attempts || 0) + 1;
          this.failures.set(key, { attempts, error: error.message || "Classifier unavailable." });
        }
        this.nextAttemptAt = Date.now() + this.retryDelay * 2 ** (attempts - 1);
        while (this.failures.size > MAX_CACHE) this.failures.delete(this.failures.keys().next().value);
      } finally {
        this.active = false;
        this.onUpdate();
        this.schedule();
      }
    }

    retry() {
      this.failures.clear();
      this.nextAttemptAt = 0;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule();
    }
  }

  return {
    CATEGORIES, LABELS, INTENTS, INTENT_LABELS, MISLEADING_THRESHOLD, BAD_FAITH_THRESHOLD,
    BATCH_SIZE, MAX_CACHE, contextFor, fingerprint, validResult, displayFor, BatchClassifier
  };
});
