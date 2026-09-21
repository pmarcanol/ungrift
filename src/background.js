"use strict";

importScripts("classification.js", "jev-client.js");

let currentKey;
let classify;
// Only the service worker and extension pages may read the saved credential.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

const categoryNames = new Set(Object.keys(globalThis.UngriftClassification.CATEGORIES));
const SOCIAL_TAB_URLS = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://www.linkedin.com/*",
  "https://linkedin.com/*"
];
const SOCIAL_PAGE_PATTERN = /^https:\/\/(?:x\.com|twitter\.com|(?:www\.)?linkedin\.com)\//;

function validHiddenCategories(value) {
  return Array.isArray(value) ? value.filter((category) => categoryNames.has(category)) : [];
}

async function broadcastToXTabs(message) {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  await Promise.allSettled(tabs.map((tab) =>
    chrome.tabs.sendMessage(tab.id, message)
  ));
}

async function broadcastToSocialTabs(message) {
  const tabs = await chrome.tabs.query({ url: SOCIAL_TAB_URLS });
  await Promise.allSettled(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message)));
}

function broadcastHiddenCategories(categories) {
  return broadcastToXTabs({ type: "apply-hidden-tweet-categories", categories });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.hiddenTweetCategories) {
    void broadcastHiddenCategories(validHiddenCategories(changes.hiddenTweetCategories.newValue));
  }
  if (changes.anonymizeSocialPosters) {
    void broadcastToSocialTabs({
      type: "apply-anonymize-social-posters",
      enabled: changes.anonymizeSocialPosters.newValue === true
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "get-anonymize-social-posters" && sender.id === chrome.runtime.id &&
      SOCIAL_PAGE_PATTERN.test(sender.url || "")) {
    void (async () => {
      await ready;
      const { anonymizeSocialPosters } = await chrome.storage.local.get("anonymizeSocialPosters");
      sendResponse({ enabled: anonymizeSocialPosters === true });
    })();
    return true;
  }

  if (message?.type === "retry-classification" && sender.id === chrome.runtime.id &&
      sender.url === chrome.runtime.getURL("popup/index.html")) {
    void broadcastToXTabs({ type: "retry-classification" })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "get-hidden-tweet-categories" && sender.id === chrome.runtime.id &&
      /^https:\/\/(?:x\.com|twitter\.com)\//.test(sender.url || "")) {
    void (async () => {
      await ready;
      const { hiddenTweetCategories } = await chrome.storage.local.get("hiddenTweetCategories");
      sendResponse({ categories: validHiddenCategories(hiddenTweetCategories) });
    })();
    return true;
  }

  if (message?.type !== "classify-tweets" || sender.id !== chrome.runtime.id ||
      !/^https:\/\/(?:x\.com|twitter\.com)\//.test(sender.url || "")) return;
  void (async () => {
    try {
      await ready;
      const { typesafeApiKey } = await chrome.storage.local.get("typesafeApiKey");
      if (!classify || currentKey !== typesafeApiKey) {
        currentKey = typesafeApiKey;
        classify = globalThis.UngriftJev.createClassifier({ apiKey: currentKey });
      }
      sendResponse(await classify(message.tweets));
    } catch (error) {
      sendResponse({ error: error.status ? error.message : "Jev classification failed. Open Ungrift settings to retry." });
    }
  })();
  return true;
});
