(function (root) {
  "use strict";
  const STORAGE_KEY = "manualPostAnnotations";
  const LABELS = ["slop", "grift", "value"];
  function string(value, max, name) {
    if (value == null) return null;
    if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${name}`);
    return value;
  }
  function probability(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  }
  function probabilities(value) {
    return Object.fromEntries(Object.entries(value || {}).filter(([key, number]) =>
      /^[a-z_]{1,40}$/.test(key) && probability(number) !== null));
  }
  function modelSnapshot(value) {
    if (!value || typeof value !== "object") return null;
    return {
      status: string(value.status, 40, "model status"),
      model: string(value.model, 200, "model name"),
      category: string(value.category, 40, "model category"),
      confidence: probability(value.confidence),
      probabilities: probabilities(value.probabilities),
      intent: value.intent ? {
        value: string(value.intent.value, 40, "intent"),
        confidence: probability(value.intent.confidence),
        probabilities: probabilities(value.intent.probabilities)
      } : null,
      misleadingProbability: probability(value.misleadingProbability),
      badFaithProbability: probability(value.badFaithProbability)
    };
  }
  function identity(platform, key) {
    if (!["x", "linkedin"].includes(platform) || typeof key !== "string" || !key || key.length > 20000) {
      throw new Error("Invalid post identity");
    }
    return key.startsWith(`${platform}:`) ? key : `${platform}:${key}`;
  }
  function annotation(input, platform, previous, version, now = new Date().toISOString()) {
    const id = identity(platform, input?.key);
    if (!LABELS.includes(input.label)) throw new Error("Choose slop, grift, or value");
    const post = input.post || {};
    const handle = string(post.handle, 1000, "author");
    const content = string(post.content, 100000, "post text");
    if (!handle && !content) throw new Error("Post context is missing");
    const postId = platform === "linkedin" ? input.key.replace(/^linkedin:/, "") : input.key;
    let url = null;
    if (platform === "x" && /^\d+$/.test(input.key)) url = `https://x.com/i/status/${input.key}`;
    if (platform === "linkedin" && /^urn:li:(?:activity|share|ugcPost):\d+$/.test(postId)) {
      url = `https://www.linkedin.com/feed/update/${postId}/`;
    }
    return {
      id, platform, postId, url,
      label: input.label, note: string(input.note || "", 4000, "note"),
      post: { handle, content,
        profileDescription: string(post.profileDescription, 20000, "author context"),
        citedOrRetweetedTweetContent: string(post.citedOrRetweetedTweetContent, 100000, "quoted text") },
      model: modelSnapshot(input.classification),
      extensionVersion: version,
      createdAt: previous?.createdAt || now, updatedAt: now
    };
  }
  function dataset(records, now = new Date().toISOString()) {
    return { schemaVersion: 1, exportedAt: now, source: "Ungrift manual post labels",
      labels: { slop: "Fluff or low-substance content", grift: "Manipulation or self-serving promotion", value: "Useful, substantive content" },
      annotations: Object.values(records || {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) };
  }
  const api = { STORAGE_KEY, LABELS, identity, annotation, dataset };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.UngriftAnnotations = api;
})(globalThis);
