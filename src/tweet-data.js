(function exposeTweetData(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    Object.defineProperty(root, "__UNGRIFT_TWEET_DATA__", {
      configurable: true,
      value: api
    });
  }
})(typeof globalThis === "object" ? globalThis : undefined, function createTweetData() {
  "use strict";

  const MAX_UNWRAP_DEPTH = 8;

  function unwrapResult(value) {
    let current = value;

    for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
      if (!current || typeof current !== "object") return null;
      if (current.__typename === "Tweet" || current.legacy?.full_text) return current;
      if (current.tweet && typeof current.tweet === "object") {
        current = current.tweet;
        continue;
      }
      if (current.result && typeof current.result === "object") {
        current = current.result;
        continue;
      }
      break;
    }

    return current && typeof current === "object" ? current : null;
  }

  function normalizeUser(value) {
    let user = value;

    for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
      if (!user || typeof user !== "object") return null;
      if (user.legacy?.screen_name || user.core?.screen_name) break;
      user = user.result || user.user || null;
    }

    const handle = user?.legacy?.screen_name || user?.core?.screen_name;
    if (!handle) return null;

    return {
      handle: `@${String(handle).replace(/^@/, "")}`,
      profileDescription: user.legacy?.description ?? user.profile_bio?.description ?? null
    };
  }

  function summarizeTweet(value) {
    const tweet = unwrapResult(value);
    if (!tweet) return null;

    const user = normalizeUser(tweet.core?.user_results?.result);
    const content = tweet.note_tweet?.note_tweet_results?.result?.text ?? tweet.legacy?.full_text;

    if (!tweet.rest_id || typeof content !== "string") return null;

    return {
      id: String(tweet.rest_id),
      handle: user?.handle ?? null,
      profileDescription: user?.profileDescription ?? null,
      content
    };
  }

  function normalizeTweet(value) {
    const tweet = unwrapResult(value);
    const summary = summarizeTweet(tweet);
    if (!tweet || !summary) return null;

    const quoted = summarizeTweet(tweet.quoted_status_result?.result);
    const retweeted = summarizeTweet(
      tweet.legacy?.retweeted_status_result?.result || tweet.retweeted_status_result?.result
    );

    return {
      ...summary,
      quoted,
      retweeted
    };
  }

  function collectTweets(payload) {
    if (!payload || typeof payload !== "object") return [];

    const stack = [payload];
    const visited = new WeakSet();
    const tweets = new Map();

    while (stack.length > 0) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);

      const normalized = normalizeTweet(value);
      if (normalized) tweets.set(normalized.id, normalized);

      if (Array.isArray(value)) {
        for (const item of value) stack.push(item);
      } else {
        for (const item of Object.values(value)) stack.push(item);
      }
    }

    return [...tweets.values()];
  }

  return { collectTweets, normalizeTweet, normalizeUser, unwrapResult };
});
