"use strict";

importScripts("classification.js", "jev-client.js");

let currentKey;
let classify;
// Only the service worker and extension pages may read the saved credential.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

const categoryNames = new Set(Object.keys(globalThis.UngriftClassification.CATEGORIES));

function validHiddenCategories(value) {
  return Array.isArray(value) ? value.filter((category) => categoryNames.has(category)) : [];
}

async function broadcastToXTabs(message) {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  await Promise.allSettled(tabs.map((tab) =>
    chrome.tabs.sendMessage(tab.id, message)
  ));
}

function broadcastHiddenCategories(categories) {
  return broadcastToXTabs({ type: "apply-hidden-tweet-categories", categories });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.hiddenTweetCategories) return;
  void broadcastHiddenCategories(validHiddenCategories(changes.hiddenTweetCategories.newValue));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
