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

    const text = (value) => typeof value === "string" ? value.trim() : "";
    const bio = text(user.legacy?.description ?? user.profile_bio?.description);
    const categories = Array.isArray(user.professional?.category)
      ? user.professional.category.map((category) => text(category?.name)).filter(Boolean) : [];
    const links = user.profile_bio?.entities?.url?.urls ?? user.legacy?.entities?.url?.urls;
    const websites = Array.isArray(links)
      ? links.map((link) => text(link?.expanded_url)).filter((url) => /^https?:\/\//i.test(url)) : [];
    const profileDescription = [bio,
      categories.length ? `Professional category: ${[...new Set(categories)].join(", ")}` : "",
      websites.length ? `Profile website: ${[...new Set(websites)].join(", ")}` : ""
    ].filter(Boolean).join("\n") || null;

    return {
      handle: `@${String(handle).replace(/^@/, "")}`,
      profileDescription
    };
  }

  function summarizeTweet(value) {
    const tweet = unwrapResult(value);
    if (!tweet) return null;

    const user = normalizeUser(tweet.core?.user_results?.result);
    let content = tweet.note_tweet?.note_tweet_results?.result?.text ?? tweet.legacy?.full_text;
    // X article cards often have only a t.co URL as full_text. Use the title
    // and preview already supplied by the timeline, never fetch the article.
    const article = tweet.article?.article_results?.result;
    const preview = [article?.title, article?.preview_text]
      .filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
    if (preview.length) {
      content = [typeof content === "string" ? content.trim() : "", `Article preview:\n${preview.join("\n")}`]
        .filter(Boolean).join("\n\n");
    }

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
