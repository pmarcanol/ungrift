"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectTweets, normalizeTweet } = require("../src/tweet-data.js");

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
