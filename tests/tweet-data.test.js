"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectTweets, normalizeTweet, normalizeUser } = require("../src/tweet-data.js");

function tweet(id, handle, description, content, extras = {}) {
  const { legacy: legacyExtras, ...topLevelExtras } = extras;

  return {
    __typename: "Tweet",
    rest_id: id,
    core: {
      user_results: {
        result: {
          legacy: { screen_name: handle, description }
        }
      }
    },
    legacy: { full_text: content, ...legacyExtras },
    ...topLevelExtras
  };
}

test("normalizes a tweet and its quoted tweet", () => {
  const quoted = tweet("22", "quoted_user", "Quoted bio", "Quoted copy");
  const source = tweet("11", "author", "Author bio", "Main copy", {
    quoted_status_result: { result: quoted }
  });

  assert.deepEqual(normalizeTweet(source), {
    id: "11",
    handle: "@author",
    profileDescription: "Author bio",
    content: "Main copy",
    quoted: {
      id: "22",
      handle: "@quoted_user",
      profileDescription: "Quoted bio",
      content: "Quoted copy"
    },
    retweeted: null
  });
});

test("finds tweets nested inside a timeline response without duplicates", () => {
  const repeated = tweet("33", "someone", "A profile", "Timeline copy");
  const payload = {
    data: {
      home: {
        timeline: {
          instructions: [{ entries: [{ content: { itemContent: { tweet_results: { result: repeated } } } }] }]
        }
      }
    },
    duplicate: repeated
  };

  assert.equal(collectTweets(payload).length, 1);
  assert.equal(collectTweets(payload)[0].handle, "@someone");
});

test("normalizes a legacy retweet reference", () => {
  const original = tweet("44", "original", "Original profile", "Original words");
  const repost = tweet("55", "reposter", "Reposter profile", "RT @original: Original words", {
    legacy: { retweeted_status_result: { result: original } }
  });

  assert.equal(normalizeTweet(repost).retweeted.content, "Original words");
});

test("prefers the complete note-tweet text over the truncated legacy text", () => {
  const longTweet = tweet("66", "writer", "Writer profile", "Truncated…", {
    note_tweet: { note_tweet_results: { result: { text: "The complete long-form tweet" } } }
  });

  assert.equal(normalizeTweet(longTweet).content, "The complete long-form tweet");
});

test("modern and legacy X profiles retain professional categories and supplied website destinations", () => {
  const urls = [{ expanded_url: "https://example.com/channel" }];
  for (const user of [
    { core: { screen_name: "creator" }, profile_bio: { description: "Early insights", entities: { url: { urls } } } },
    { legacy: { screen_name: "creator", description: "Early insights", entities: { url: { urls } } } }
  ]) {
    user.professional = { category: [{ name: "Social Media Influencer" }] };
    assert.equal(normalizeUser({ result: user }).profileDescription,
      "Early insights\nProfessional category: Social Media Influencer\nProfile website: https://example.com/channel");
  }
  assert.equal(normalizeUser({ core: { screen_name: "unknown" } }).profileDescription, null);
});

test("X article previews and quoted article previews are not reduced to bare links", () => {
  const article = tweet("77", "publisher", "Publisher bio", "https://t.co/example", {
    article: { article_results: { result: {
      title: "Build an income stream with AI", preview_text: "One person, no team, huge monthly returns."
    } } }
  });
  const content = "https://t.co/example\n\nArticle preview:\nBuild an income stream with AI\nOne person, no team, huge monthly returns.";
  assert.equal(normalizeTweet(article).content, content);
  const quote = normalizeTweet(tweet("88", "critic", "Engineer", "This promise leaves out the risks.", {
    quoted_status_result: { result: article }
  }));
  assert.equal(quote.content, "This promise leaves out the risks.");
  assert.equal(quote.profileDescription, "Engineer");
  assert.equal(quote.quoted.content, content);
  assert.equal(quote.quoted.profileDescription, "Publisher bio");
});
