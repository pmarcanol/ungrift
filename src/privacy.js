(function initializeRecordingPrivacy(globalScope) {
  "use strict";

  const HONORIFICS = new Set([
    "dr", "doctor", "mr", "mister", "mrs", "missus", "ms", "miss", "mx",
    "prof", "professor", "sir", "dame", "rev", "reverend"
  ]);
  const ROOT_ATTRIBUTE = "data-ungrift-anonymize-posters";
  const NAME_CLASS = "ungrift-private-name";
  const HANDLE_CLASS = "ungrift-private-handle";
  const AVATAR_CLASS = "ungrift-private-avatar";
  const AVATAR_SHELL_CLASS = "ungrift-private-avatar-shell";
  let enabled = false;
  let scanTimer;

  function cleanName(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function anonymizedName(value) {
    const name = cleanName(value);
    const parts = name.split(" ").filter(Boolean);
    if (parts.length < 2) return name;

    let firstNameIndex = 0;
    while (firstNameIndex < parts.length - 1) {
      const normalized = parts[firstNameIndex].replace(/[.,]/g, "").toLowerCase();
      if (!HONORIFICS.has(normalized)) break;
      firstNameIndex += 1;
    }

    return `${parts[firstNameIndex]} •••`;
  }

  function directText(element) {
    return cleanName([...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(" "));
  }

  function markNameWithin(container) {
    if (!container) return false;
    const elements = [container, ...container.querySelectorAll("span, p")];

    for (const element of elements) {
      const name = directText(element);
      if (!name || name.startsWith("@") || /^(?:verified|follow|connect)\b/i.test(name)) continue;
      const replacement = anonymizedName(name);
      if (!replacement || replacement === name) continue;

      element.classList.add(NAME_CLASS);
      element.dataset.ungriftAnonymizedName = replacement;
      element.style.setProperty("--ungrift-private-name-color", getComputedStyle(element).color);
      return true;
    }

    return false;
  }

  function markHandleWithin(container) {
    if (!container) return false;
    const elements = [container, ...container.querySelectorAll("a, span, div")];

    for (const element of elements) {
      const handle = directText(element);
      if (!/^@[A-Za-z0-9_]{1,15}$/.test(handle)) continue;

      element.classList.add(HANDLE_CLASS);
      element.dataset.ungriftAnonymizedHandle = "@•••";
      element.style.setProperty("--ungrift-private-handle-color", getComputedStyle(element).color);
      return true;
    }

    return false;
  }

  function markAvatar(image) {
    if (!image) return;
    image.classList.add(AVATAR_CLASS);
    const shell = image.closest("picture") || image.parentElement;
    shell?.classList.add(AVATAR_SHELL_CLASS);
  }

  function scanXPost(post) {
    for (const image of post.querySelectorAll(
      '[data-testid="Tweet-User-Avatar"] img, [data-testid^="UserAvatar-Container-"] img'
    )) markAvatar(image);

    const nameBlock = post.querySelector('[data-testid="User-Name"]');
    if (!nameBlock) return;
    const profileLink = [...nameBlock.querySelectorAll("a[href]")].find((link) => {
      const text = cleanName(link.textContent);
      return text && !text.includes("@") && !link.getAttribute("href")?.includes("/status/");
    });
    markNameWithin(profileLink || nameBlock);
    markHandleWithin(nameBlock);
  }

  function scanLinkedInPost(post) {
    const linkedInData = globalScope.__UNGRIFT_LINKEDIN_DATA__;
    const extracted = linkedInData?.extractPost(post);
    const actor = post.querySelector(
      ".update-components-actor, .feed-shared-actor, .update-components-actor__container"
    ) || post;
    for (const image of actor.querySelectorAll(
      "img.update-components-actor__avatar-image, img.feed-shared-actor__avatar-image, " +
      'img[class*="EntityPhoto-circle"], a[href*="/in/"] img, a[href*="/company/"] img'
    )) markAvatar(image);

    if (markNameWithin(extracted?.badgeHost)) return;
    const nameContainers = actor.querySelectorAll([
      '[data-test-id="main-feed-activity-card__actor-name"]',
      '[data-testid="main-feed-activity-card__actor-name"]',
      ".update-components-actor__name",
      ".feed-shared-actor__name",
      ".update-components-actor__title"
    ].join(","));
    for (const container of nameContainers) {
      markNameWithin(container.querySelector('[aria-hidden="true"]') || container);
    }
  }

  function scan() {
    scanTimer = undefined;
    if (!enabled) return;
    if (location.hostname === "x.com" || location.hostname === "twitter.com") {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(scanXPost);
      return;
    }
    if (location.hostname === "linkedin.com" || location.hostname === "www.linkedin.com") {
      const linkedInData = globalScope.__UNGRIFT_LINKEDIN_DATA__;
      const posts = linkedInData?.findPostElements(document) || document.querySelectorAll([
        ".feed-shared-update-v2", ".update-components-update-v2", ".occludable-update"
      ].join(","));
      posts.forEach(scanLinkedInPost);
    }
  }

  function scheduleScan() {
    if (!enabled || scanTimer) return;
    scanTimer = setTimeout(scan, 80);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    document.documentElement?.toggleAttribute(ROOT_ATTRIBUTE, enabled);
    if (enabled) scheduleScan();
  }

  function installStyles() {
    if (!document.documentElement || document.querySelector("#ungrift-privacy-styles")) return;
    const style = document.createElement("style");
    style.id = "ungrift-privacy-styles";
    style.textContent = `
      html[${ROOT_ATTRIBUTE}] .${NAME_CLASS},
      html[${ROOT_ATTRIBUTE}] .${HANDLE_CLASS} {
        position: relative !important;
        color: transparent !important;
        text-shadow: none !important;
      }
      html[${ROOT_ATTRIBUTE}] .${NAME_CLASS}::after,
      html[${ROOT_ATTRIBUTE}] .${HANDLE_CLASS}::after {
        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 0;
        white-space: nowrap;
        pointer-events: none;
      }
      html[${ROOT_ATTRIBUTE}] .${NAME_CLASS}::after {
        content: attr(data-ungrift-anonymized-name);
        color: var(--ungrift-private-name-color, currentColor) !important;
      }
      html[${ROOT_ATTRIBUTE}] .${HANDLE_CLASS}::after {
        content: attr(data-ungrift-anonymized-handle);
        color: var(--ungrift-private-handle-color, currentColor) !important;
      }
      html[${ROOT_ATTRIBUTE}] .${AVATAR_SHELL_CLASS} {
        overflow: hidden !important;
        background-color: #65727d !important;
        background-image:
          radial-gradient(circle at 50% 34%, rgba(255,255,255,.74) 0 17%, transparent 18%),
          radial-gradient(ellipse at 50% 105%, rgba(255,255,255,.74) 0 42%, transparent 43%) !important;
        background-repeat: no-repeat !important;
      }
      html[${ROOT_ATTRIBUTE}] .${AVATAR_CLASS} {
        opacity: 0 !important;
      }
    `;
    document.documentElement.append(style);
  }

  const api = { anonymizedName };
  globalScope.UngriftPrivacy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined" || typeof chrome === "undefined") return;

  installStyles();
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "apply-anonymize-social-posters") setEnabled(message.enabled);
  });
  void chrome.runtime.sendMessage({ type: "get-anonymize-social-posters" })
    .then((response) => setEnabled(response?.enabled))
    .catch(() => setEnabled(false));
})(globalThis);
