"use strict";

const categoryInputs = [...document.querySelectorAll('.category input[type="checkbox"]')];
const availableCategories = new Set(categoryInputs.map((input) => input.value));
const hiddenCount = document.querySelector("#hidden-count");
const showAllButton = document.querySelector("#show-all-categories");
const form = document.querySelector("#key-form");
const apiKeyInput = document.querySelector("#api-key");
const keyStatus = document.querySelector("#key-status");
const removeKeyButton = document.querySelector("#remove-key");
const retryButton = document.querySelector("#retry-classification");
const anonymizePostersInput = document.querySelector("#anonymize-posters");
const privacyStatus = document.querySelector("#privacy-status");
let hasSavedKey = false;

function renderHiddenCategories(categories) {
  const hidden = new Set((Array.isArray(categories) ? categories : [])
    .filter((category) => availableCategories.has(category)));
  for (const input of categoryInputs) input.checked = hidden.has(input.value);
  hiddenCount.textContent = `${hidden.size} hidden`;
  showAllButton.disabled = hidden.size === 0;
}

async function saveHiddenCategories() {
  const categories = categoryInputs.filter((input) => input.checked).map((input) => input.value);
  renderHiddenCategories(categories);
  await chrome.storage.local.set({ hiddenPostCategories: categories });
}

function renderPrivacy(enabled) {
  const isEnabled = enabled === true;
  anonymizePostersInput.checked = isEnabled;
  privacyStatus.dataset.enabled = String(isEnabled);
  privacyStatus.textContent = isEnabled ? "On" : "Off";
}

async function savePrivacy() {
  const enabled = anonymizePostersInput.checked;
  renderPrivacy(enabled);
  await chrome.storage.local.set({ anonymizeSocialPosters: enabled });
}

function showKeyState(saved, message) {
  hasSavedKey = saved;
  removeKeyButton.disabled = !saved;
  retryButton.disabled = !saved;
  keyStatus.dataset.saved = String(saved);
  keyStatus.textContent = message || (saved ? "Key connected" : "Add a key to start classification");
}

async function retryOpenTimelines() {
  try {
    await chrome.runtime.sendMessage({ type: "retry-classification" });
  } catch {
    // A supported feed may not be open yet; the next load will use the new key.
  }
}

for (const input of categoryInputs) input.addEventListener("change", () => void saveHiddenCategories());
anonymizePostersInput.addEventListener("change", () => void savePrivacy());

showAllButton.addEventListener("click", () => {
  for (const input of categoryInputs) input.checked = false;
  void saveHiddenCategories();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = apiKeyInput.value.trim();
  if (!/^apikey_[A-Za-z0-9_-]+$/.test(key)) {
    showKeyState(hasSavedKey, "Use a valid key beginning with apikey_");
    return;
  }

  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.local.set({ typesafeApiKey: key });
    apiKeyInput.value = "";
    showKeyState(true, "Saved. Retrying open timelines…");
    await retryOpenTimelines();
    showKeyState(true);
  } catch {
    showKeyState(hasSavedKey, "Could not save the key");
  }
});

removeKeyButton.addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("typesafeApiKey");
    apiKeyInput.value = "";
    showKeyState(false, "Key removed");
    await retryOpenTimelines();
  } catch {
    showKeyState(true, "Could not remove the key");
  }
});

retryButton.addEventListener("click", async () => {
  keyStatus.textContent = "Retrying open timelines…";
  await retryOpenTimelines();
  const { typesafeApiKey } = await chrome.storage.local.get("typesafeApiKey");
  showKeyState(Boolean(typesafeApiKey), "Retry sent to open feeds");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.hiddenPostCategories || changes.hiddenTweetCategories)) {
    renderHiddenCategories((changes.hiddenPostCategories || changes.hiddenTweetCategories).newValue);
  }
  if (areaName === "local" && changes.anonymizeSocialPosters) {
    renderPrivacy(changes.anonymizeSocialPosters.newValue);
  }
});

void (async () => {
  const { hiddenPostCategories, hiddenTweetCategories, typesafeApiKey, anonymizeSocialPosters } = await chrome.storage.local.get([
    "hiddenPostCategories",
    "hiddenTweetCategories",
    "typesafeApiKey",
    "anonymizeSocialPosters"
  ]);
  renderHiddenCategories(hiddenPostCategories ?? hiddenTweetCategories);
  renderPrivacy(anonymizeSocialPosters);
  showKeyState(Boolean(typesafeApiKey));
})();
