(function () {
  "use strict";
  const { STORAGE_KEY, identity, annotation } = globalThis.UngriftAnnotations;
  let writes = Promise.resolve();
  const feed = /^https:\/\/(?:x\.com|twitter\.com|(?:www\.)?linkedin\.com)\//;
  function broadcast(message) {
    void chrome.tabs.query({ url: supportedTabUrls }).then((tabs) =>
      Promise.allSettled(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message))));
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.postMarkingEnabled) broadcast({ type: "marking-mode", enabled: changes.postMarkingEnabled.newValue === true });
    if (changes[STORAGE_KEY]) broadcast({ type: "marking-labels", labels: labels(changes[STORAGE_KEY].newValue) });
  });
  function labels(records) {
    return Object.fromEntries(Object.values(records || {}).map((record) => [record.id, { label: record.label, note: record.note }]));
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.type?.startsWith("marking-") || sender.id !== chrome.runtime.id || !feed.test(sender.url || "")) return;
    const platform = /linkedin\.com\//.test(sender.url) ? "linkedin" : "x";
    async function handle() {
      await ready;
      if (message.type === "marking-state") {
        const state = await chrome.storage.local.get(["postMarkingEnabled", STORAGE_KEY]);
        return { enabled: state.postMarkingEnabled === true, labels: labels(state[STORAGE_KEY]) };
      }
      if (message.type === "marking-stop") {
        await chrome.storage.local.set({ postMarkingEnabled: false });
        return { ok: true };
      }
      if (!["marking-save", "marking-delete"].includes(message.type)) throw new Error("Unknown marking action");
      const id = identity(platform, message.key);
      const state = await chrome.storage.local.get(STORAGE_KEY);
      const records = { ...state[STORAGE_KEY] };
      if (message.type === "marking-delete") delete records[id];
      else {
        records[id] = annotation(message, platform, records[id], chrome.runtime.getManifest().version);
        records[id].modelInput = globalThis.UngriftClassification.contextFor(records[id].post);
      }
      await chrome.storage.local.set({ [STORAGE_KEY]: records });
      return { ok: true, label: records[id]?.label || null };
    }
    // Serialize read/modify/write operations across tabs, including deletion.
    const operation = writes.then(handle);
    writes = operation.catch(() => {});
    void operation.then(respond, () => respond({ error: "Could not save your label locally. Please retry or export your existing labels." }));
    return true;
  });
})();
