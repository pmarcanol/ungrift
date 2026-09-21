"use strict";

importScripts("classification.js", "jev-client.js");

let currentKey;
let classify;
// Only the service worker and extension pages may read the saved credential.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const supportedTabUrls = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://www.linkedin.com/*",
  "https://linkedin.com/*"
];
const supportedSender = /^https:\/\/(?:x\.com|twitter\.com|(?:www\.)?linkedin\.com)\//;

const categoryNames = new Set(Object.keys(globalThis.UngriftClassification.CATEGORIES));

function validHiddenCategories(value) {
  return Array.isArray(value) ? value.filter((category) => categoryNames.has(category)) : [];
}

async function broadcastToFeedTabs(message) {
  const tabs = await chrome.tabs.query({ url: supportedTabUrls });
  await Promise.allSettled(tabs.map((tab) =>
    chrome.tabs.sendMessage(tab.id, message)
  ));
}

function broadcastHiddenCategories(categories) {
  return broadcastToFeedTabs({ type: "apply-hidden-post-categories", categories });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes.hiddenPostCategories || changes.hiddenTweetCategories;
  if (change) void broadcastHiddenCategories(validHiddenCategories(change.newValue));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "retry-classification" && sender.id === chrome.runtime.id &&
      sender.url === chrome.runtime.getURL("popup/index.html")) {
    void broadcastToFeedTabs({ type: "retry-classification" })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if ((message?.type === "get-hidden-post-categories" || message?.type === "get-hidden-tweet-categories") &&
      sender.id === chrome.runtime.id && supportedSender.test(sender.url || "")) {
    void (async () => {
      await ready;
      const { hiddenPostCategories, hiddenTweetCategories } = await chrome.storage.local.get([
        "hiddenPostCategories", "hiddenTweetCategories"
      ]);
      sendResponse({ categories: validHiddenCategories(hiddenPostCategories ?? hiddenTweetCategories) });
    })();
    return true;
  }

  if (!(["classify-posts", "classify-tweets"].includes(message?.type)) ||
      sender.id !== chrome.runtime.id || !supportedSender.test(sender.url || "")) return;
  void (async () => {
    try {
      await ready;
      const { typesafeApiKey } = await chrome.storage.local.get("typesafeApiKey");
      if (!classify || currentKey !== typesafeApiKey) {
        currentKey = typesafeApiKey;
        classify = globalThis.UngriftJev.createClassifier({ apiKey: currentKey });
      }
      const platform = /^https:\/\/(?:www\.)?linkedin\.com\//.test(sender.url) ? "linkedin" : "x";
      sendResponse(await classify(message.posts || message.tweets, platform));
    } catch (error) {
      sendResponse({ error: error.status ? error.message : "Jev classification failed. Open Ungrift settings to retry." });
    }
  })();
  return true;
});
