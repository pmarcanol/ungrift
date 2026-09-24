(function watchRenderedTimeline() {
  "use strict";

  const MESSAGE_TYPE = "UNGRIFT_TIMELINE_DATA_V1";
  const isLinkedIn = /(^|\.)linkedin\.com$/i.test(location.hostname);
  const linkedInData = globalThis.__UNGRIFT_LINKEDIN_DATA__;
  const tweetById = new Map();
  const profileByHandle = new Map();
  const repostByTweetId = new Map();
  const numberByPostKey = new Map();
  const annotationByCard = new WeakMap();
  const hiddenCategories = new Set();
  let latestSnapshot = [];
  let updateTimer;
  let nextPostNumber = 1;
  const {
    BatchClassifier, CATEGORIES, categoriesFor, INTENT_LABELS, displayFor
  } = globalThis.UngriftClassification;
  const categoryDescriptions = categoriesFor(isLinkedIn ? "linkedin" : "x");
  const classifier = new BatchClassifier(
    (posts) => chrome.runtime.sendMessage({ type: "classify-posts", posts }),
    { onUpdate: refreshAfterClassification }
  );

  function refreshAfterClassification() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(publishSnapshot, 0);
  }

  function installAnnotationStyles() {
    if (document.querySelector("#ungrift-styles")) return;

    const style = document.createElement("style");
    style.id = "ungrift-styles";
    style.textContent = `
      .ungrift-handle {
        display: inline-flex !important;
        flex-flow: row nowrap !important;
        align-items: center !important;
        white-space: nowrap !important;
      }

      .ungrift-badge-anchor {
        display: flex;
        align-items: center;
        min-height: 24px;
        padding: 8px 16px 0;
      }

      .ungrift-linkedin-author {
        display: flex !important;
        align-items: center;
        flex-wrap: wrap;
      }
      .ungrift-linkedin-author > .ungrift-label {
        grid-area: auto !important;
        width: max-content;
      }

      .ungrift-label {
        display: inline-grid !important;
        place-items: center;
        flex: 0 0 auto;
        min-width: 17px;
        min-height: 19px;
        margin: 0 0 0 5px;
        padding: 1px 6px;
        border: 1px solid currentColor;
        border-radius: 999px;
        color: #cbd5e1;
        background: #111827;
        font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        vertical-align: middle;
        white-space: nowrap;
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.22);
      }
      .ungrift-label[data-category="grift"] { color: #be123c; border-color: #fda4af; background: #fff1f2; }
      .ungrift-label[data-category="good_intent"] { color: #15803d; border-color: #86efac; background: #f0fdf4; }
      .ungrift-label[data-category="unclear"] { color: #475569; border-color: #cbd5e1; background: #f8fafc; }
      .ungrift-label[data-risk="misleading"] { color: #9a3412; border-color: #fb923c; background: #fff7ed; }
      .ungrift-label[data-risk="bad_faith"] { color: #fff; border-color: #e11d48; background: #be123c; }
      .ungrift-label[data-state="error"] { border-style: dashed; }
      .ungrift-label[hidden] { display: none !important; }

      .ungrift-category-hidden {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function cleanText(value) {
    return typeof value === "string" ? value.replace(/\u00a0/g, " ").trim() : null;
  }

  function cacheTweet(tweet) {
    if (!tweet?.id) return;
    tweetById.set(String(tweet.id), tweet);

    if (tweet.handle && tweet.profileDescription != null) {
      profileByHandle.set(tweet.handle.toLowerCase(), tweet.profileDescription);
    }

    for (const reference of [tweet.quoted, tweet.retweeted]) {
      if (!reference) continue;
      tweetById.set(String(reference.id), {
        ...reference,
        quoted: null,
        retweeted: null
      });
      if (reference.handle && reference.profileDescription != null) {
        profileByHandle.set(reference.handle.toLowerCase(), reference.profileDescription);
      }
    }

    if (tweet.retweeted?.id) {
      repostByTweetId.set(String(tweet.retweeted.id), tweet);
    }
  }

  function statusIdFromArticle(article) {
    const timedLink = article.querySelector("a:has(time)");
    const links = timedLink ? [timedLink] : article.querySelectorAll('a[href*="/status/"]');

    for (const link of links) {
      const match = link.getAttribute("href")?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }

    return null;
  }

  function handleFromArticle(article) {
    const nameBlock = article.querySelector('[data-testid="User-Name"]')?.cloneNode(true);
    nameBlock?.querySelectorAll(".ungrift-label").forEach((badge) => badge.remove());
    const match = nameBlock?.textContent?.match(/@[A-Za-z0-9_]+/);
    return match ? match[0] : null;
  }

  function textBlocksFromArticle(article) {
    return [...article.querySelectorAll('[data-testid="tweetText"]')]
      .filter((node) => node.closest('article[data-testid="tweet"]') === article)
      .map((node) => cleanText(node.innerText || node.textContent))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
  }

  function matchingCachedTweet(id, handle, content) {
    if (id && tweetById.has(id)) return tweetById.get(id);

    const normalizedHandle = handle?.toLowerCase();
    for (const tweet of tweetById.values()) {
      if (normalizedHandle && tweet.handle?.toLowerCase() !== normalizedHandle) continue;
      if (content && tweet.content === content) return tweet;
    }

    return null;
  }

  function applyHiddenCategories(categories) {
    hiddenCategories.clear();
    for (const category of Array.isArray(categories) ? categories : []) {
      if (Object.hasOwn(CATEGORIES, category)) hiddenCategories.add(category);
    }
    scheduleUpdate();
  }

  function annotatePost(card, postKey, handle, classification, preferredBadgeHost) {
    let annotation = annotationByCard.get(card);

    if (!annotation || annotation.postKey !== postKey) {
      if (isLinkedIn) {
        card.querySelectorAll(".ungrift-label, :scope > .ungrift-badge-anchor")
          .forEach((node) => node.remove());
      }
      let postNumber = numberByPostKey.get(postKey);
      if (!postNumber) {
        postNumber = nextPostNumber;
        nextPostNumber += 1;
        numberByPostKey.set(postKey, postNumber);
      }

      annotation = {
        postKey,
        postNumber,
        elementId: `ungrift-post-${postNumber}`
      };
      annotationByCard.set(card, annotation);
    }

    // LinkedIn uses its own element IDs. Keep them intact when annotating cards.
    if (!card.id || card.id.startsWith("ungrift-post-")) card.id = annotation.elementId;
    card.dataset.ungriftPostNumber = String(annotation.postNumber);

    const nameBlock = isLinkedIn ? preferredBadgeHost : card.querySelector('[data-testid="User-Name"]');
    if (nameBlock) {
      let badge = annotation.badge && card.contains(annotation.badge)
        ? annotation.badge
        : nameBlock.querySelector(":scope .ungrift-label");
      const handleLink = !isLinkedIn && [...nameBlock.querySelectorAll("a")].find((link) =>
        link.textContent?.includes(handle || "@")
      );

      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ungrift-label";
      }

      if (isLinkedIn) {
        // A sibling cannot become part of the author's name or clickable profile.
        // SDUI applies an overlapping grid area to every child of actor wrappers.
        if (nameBlock.tagName === "A") nameBlock.parentElement.classList.add("ungrift-linkedin-author");
        if (badge.previousElementSibling !== nameBlock) nameBlock.insertAdjacentElement("afterend", badge);
        card.querySelector(":scope > .ungrift-badge-anchor")?.remove();
      } else if (handleLink) {
        handleLink.classList.add("ungrift-handle");
        if (badge.parentElement !== handleLink) handleLink.append(badge);
      } else {
        nameBlock.classList.add("ungrift-handle");
        if (badge.parentElement !== nameBlock) nameBlock.append(badge);
      }

      annotation.badge = badge;
      updateBadge(badge, annotation, classification);
    } else if (isLinkedIn) {
      let anchor = card.querySelector(":scope > .ungrift-badge-anchor");
      if (!anchor) {
        anchor = document.createElement("div");
        anchor.className = "ungrift-badge-anchor";
        card.prepend(anchor);
      }
      const badge = anchor.querySelector(".ungrift-label") || document.createElement("span");
      badge.className = "ungrift-label";
      if (!badge.parentElement) anchor.append(badge);
      annotation.badge = badge;
      updateBadge(badge, annotation, classification);
    }

    return annotation;
  }

  function updateBadge(badge, annotation, classification) {
    const category = classification.category;
    const intent = classification.intent?.value;
    const display = displayFor(classification);
    const label = display?.label || {
      pending: "Classifying…", error: "Classifier offline", unavailable: "No text"
    }[classification.status];
    const showBadge = Boolean(label);
    const description = category
      ? `AI assessment of this post's available context. Verdict: ${categoryDescriptions[category]} Verdict confidence: ${Math.round(classification.confidence * 100)}%. Likely communicative intent: ${INTENT_LABELS[intent]} (${Math.round(classification.intent.confidence * 100)}% confidence). Misleading-impression risk: ${Math.round(classification.misleadingProbability * 100)}%. Observable bad-faith signals: ${Math.round(classification.badFaithProbability * 100)}%. These are provisional judgments, not verified facts about the author or their private intent.`
      : classification.error || (classification.status === "unavailable" ? "No post text available to classify." : "Queued for batched Jev classification.");
    badge.dataset.category = category || "";
    badge.dataset.risk = display?.risk || "";
    badge.dataset.state = classification.status;
    badge.hidden = !showBadge;
    if (showBadge) {
      badge.setAttribute("aria-label", `Post ${annotation.postNumber}: ${label}. ${description}`);
      badge.title = `Feed #${annotation.postNumber} · ${description}`;
    } else {
      badge.removeAttribute("aria-label");
      badge.removeAttribute("title");
    }
    const badgeText = label || "";
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
  }

  function extractArticle(article) {
    const id = statusIdFromArticle(article);
    const handle = handleFromArticle(article);
    const textBlocks = textBlocksFromArticle(article);
    const cached = matchingCachedTweet(id, handle, textBlocks[0]);
    const repostWrapper = id ? repostByTweetId.get(id) : null;
    const socialContext = cleanText(article.querySelector('[data-testid="socialContext"]')?.textContent);
    const isRepost = /repost|retweeted/i.test(socialContext || "") || Boolean(repostWrapper);

    const resolvedHandle = handle || cached?.handle || repostWrapper?.retweeted?.handle || null;
    const content = cached?.content || repostWrapper?.retweeted?.content || textBlocks[0] || null;
    let referencedContent =
      cached?.quoted?.content || cached?.retweeted?.content || textBlocks[1] || null;

    if (!referencedContent && isRepost) {
      referencedContent = repostWrapper?.retweeted?.content || content;
    }

    if (!resolvedHandle && !content) return null;

    const key = id || `${resolvedHandle || "unknown"}:${content || ""}`;
    const context = {
      handle: resolvedHandle,
      content,
      profileDescription:
        cached?.profileDescription ??
        repostWrapper?.retweeted?.profileDescription ??
        profileByHandle.get(resolvedHandle?.toLowerCase()) ??
        null,
      citedOrRetweetedTweetContent: referencedContent
    };
    return classifyAndAnnotate(article, key, context);
  }

  function extractLinkedInPost(card) {
    const extracted = linkedInData?.extractPost(card);
    if (!extracted) return null;

    const context = {
      handle: extracted.handle,
      content: extracted.content,
      profileDescription: extracted.profileDescription,
      citedOrRetweetedTweetContent: extracted.citedOrRetweetedTweetContent
    };
    return classifyAndAnnotate(card, extracted.key, context, extracted.badgeHost);
  }

  // Both platforms share the entire classification/display/filter lifecycle.
  // Their adapters differ only in how they find the post and its evidence.
  function classifyAndAnnotate(card, key, context, badgeHost) {
    const classification = classifier.get(context);
    globalThis.UngriftMarker?.register(card, key, context, classification);
    const annotation = annotatePost(card, key, context.handle, classification, badgeHost);
    const displayedCategory = displayFor(classification) ? classification.category : null;
    const isHidden = Boolean(displayedCategory && hiddenCategories.has(displayedCategory));
    card.classList.toggle("ungrift-category-hidden", isHidden);
    if (displayedCategory) card.dataset.ungriftCategory = displayedCategory;
    else delete card.dataset.ungriftCategory;

    return {
      key,
      isHidden,
      value: {
        postNumber: annotation.postNumber,
        elementId: annotation.elementId,
        ...context,
        category: displayedCategory,
        classification
      }
    };
  }

  function makeSnapshot() {
    const uniquePosts = new Map();

    const cards = isLinkedIn
      ? linkedInData?.findPostElements(document) || []
      : document.querySelectorAll('article[data-testid="tweet"]');
    for (const card of cards) {
      const extracted = isLinkedIn ? extractLinkedInPost(card) : extractArticle(card);
      if (extracted && !extracted.isHidden) uniquePosts.set(extracted.key, extracted.value);
    }

    return [...uniquePosts.values()];
  }

  function publishSnapshot() {
    updateTimer = undefined;
    latestSnapshot = makeSnapshot();
    classifier.update(latestSnapshot);

  }

  function scheduleUpdate() {
    if (updateTimer) return;
    updateTimer = setTimeout(publishSnapshot, 120);
  }

  window.addEventListener("message", (event) => {
    if (isLinkedIn) return;
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== MESSAGE_TYPE) {
      return;
    }

    for (const tweet of event.data.tweets || []) cacheTweet(tweet);
    scheduleUpdate();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "apply-hidden-post-categories" || message?.type === "apply-hidden-tweet-categories") {
      applyHiddenCategories(message.categories);
    } else if (message?.type === "retry-classification") {
      classifier.retry();
      refreshAfterClassification();
    }
  });

  void chrome.runtime.sendMessage({ type: "get-hidden-post-categories" })
    .then((response) => applyHiddenCategories(response?.categories))
    .catch(() => applyHiddenCategories([]));

  const observer = new MutationObserver(scheduleUpdate);
  installAnnotationStyles();
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["data-urn", "data-id", "componentkey", "href"]
  });
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  document.addEventListener("visibilitychange", scheduleUpdate);
  scheduleUpdate();
})();
