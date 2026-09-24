(function () {
  "use strict";
  const { STORAGE_KEY, dataset } = globalThis.UngriftAnnotations;
  const toggle = document.querySelector("#marking-mode");
  const count = document.querySelector("#marked-count");
  const status = document.querySelector("#marking-status");
  const exportButton = document.querySelector("#export-labels");
  function render(state) {
    toggle.checked = state.postMarkingEnabled === true;
    const records = Object.values(state[STORAGE_KEY] || {});
    count.textContent = `${records.length} saved`;
    document.querySelector("#label-counts").textContent = ["slop", "grift", "value"]
      .map((label) => `${records.filter((record) => record.label === label).length} ${label}`).join(" · ");
    exportButton.disabled = !records.length;
  }
  async function refresh() {
    render(await chrome.storage.local.get(["postMarkingEnabled", STORAGE_KEY]));
  }
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    try {
      await chrome.storage.local.set({ postMarkingEnabled: toggle.checked });
      status.textContent = toggle.checked ? "Click a post in your feed to label it." : "Labels stay saved when marking is off.";
    } catch { status.textContent = "Could not change marking mode. Please retry."; await refresh(); }
    finally { toggle.disabled = false; }
  });
  exportButton.addEventListener("click", async () => {
    try {
      const state = await chrome.storage.local.get(STORAGE_KEY);
      const json = JSON.stringify(dataset(state[STORAGE_KEY]), null, 2) + "\n";
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ungrift-labels-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = "JSON download started. Your labels remain saved here.";
    } catch { status.textContent = "Could not export labels. Please retry."; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.postMarkingEnabled || changes[STORAGE_KEY])) void refresh();
  });
  void refresh().catch(() => { status.textContent = "Could not read saved labels. Reopen settings to retry."; });
})();
