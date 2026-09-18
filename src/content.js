(function watchRenderedTimeline() {
  "use strict";

  const MESSAGE_TYPE = "UNGRIFT_TIMELINE_DATA_V1";
  const tweetById = new Map();
  const profileByHandle = new Map();
  const repostByTweetId = new Map();
  const numberByTweetKey = new Map();
  const annotationByArticle = new WeakMap();
  const hiddenCategories = new Set();
  let latestSnapshot = [];
  let updateTimer;
  let nextTweetNumber = 1;
  const {
    BatchClassifier, CATEGORIES, INTENT_LABELS, displayFor
  } = globalThis.UngriftClassification;
  const classifier = new BatchClassifier(
    (tweets) => chrome.runtime.sendMessage({ type: "classify-tweets", tweets }),
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

      article.ungrift-category-hidden {
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

  function annotateArticle(article, tweetKey, handle, classification) {
    let annotation = annotationByArticle.get(article);

    if (!annotation || annotation.tweetKey !== tweetKey) {
      let tweetNumber = numberByTweetKey.get(tweetKey);
      if (!tweetNumber) {
        tweetNumber = nextTweetNumber;
        nextTweetNumber += 1;
        numberByTweetKey.set(tweetKey, tweetNumber);
      }

      annotation = {
        tweetKey,
        tweetNumber,
        elementId: `ungrift-tweet-${tweetNumber}`
      };
      annotationByArticle.set(article, annotation);
    }

    article.id = annotation.elementId;
    article.dataset.ungriftTweetNumber = String(annotation.tweetNumber);

    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    if (nameBlock) {
      let badge = nameBlock.querySelector(":scope .ungrift-label");
      const handleLink = [...nameBlock.querySelectorAll("a")].find((link) =>
        link.textContent?.includes(handle || "@")
      );

      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ungrift-label";
      }

      if (handleLink) {
        handleLink.classList.add("ungrift-handle");
        if (badge.parentElement !== handleLink) handleLink.append(badge);
      } else {
        nameBlock.classList.add("ungrift-handle");
        if (badge.parentElement !== nameBlock) nameBlock.append(badge);
      }

      const category = classification.category;
      const intent = classification.intent?.value;
      const display = displayFor(classification);
      const label = display?.label || {
        pending: "Classifying…", error: "Classifier offline", unavailable: "No text"
      }[classification.status];
      const description = category
        ? `AI assessment of this post's available context. Verdict: ${CATEGORIES[category]} Verdict confidence: ${Math.round(classification.confidence * 100)}%. Likely communicative intent: ${INTENT_LABELS[intent]} (${Math.round(classification.intent.confidence * 100)}% confidence). Misleading-impression risk: ${Math.round(classification.misleadingProbability * 100)}%. Observable bad-faith signals: ${Math.round(classification.badFaithProbability * 100)}%. These are provisional judgments, not verified facts about the author or their private intent.`
        : classification.error || (classification.status === "unavailable" ? "No post text available to classify." : "Queued for batched Jev classification.");
      badge.dataset.category = category || "";
      badge.dataset.risk = display?.risk || "";
      badge.dataset.state = classification.status;
      badge.setAttribute("aria-label", `Tweet ${annotation.tweetNumber}: ${label}. ${description}`);
      badge.title = `Timeline #${annotation.tweetNumber} · ${description}`;
      if (badge.textContent !== label) badge.textContent = label;
    }

    return annotation;
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
    const classification = classifier.get(context);
    const annotation = annotateArticle(article, key, resolvedHandle, classification);
    const isHidden = Boolean(classification.category && hiddenCategories.has(classification.category));
    article.classList.toggle("ungrift-category-hidden", isHidden);
    if (classification.category) article.dataset.ungriftCategory = classification.category;
    else delete article.dataset.ungriftCategory;

    return {
      key,
      isHidden,
      value: {
        tweetNumber: annotation.tweetNumber,
        elementId: annotation.elementId,
        ...context,
        category: classification.category || null,
        classification
      }
    };
  }

  function makeSnapshot() {
    const uniqueTweets = new Map();

    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const extracted = extractArticle(article);
      if (extracted && !extracted.isHidden) uniqueTweets.set(extracted.key, extracted.value);
    }

    return [...uniqueTweets.values()];
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
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== MESSAGE_TYPE) {
      return;
    }

    for (const tweet of event.data.tweets || []) cacheTweet(tweet);
    scheduleUpdate();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "apply-hidden-tweet-categories") {
      applyHiddenCategories(message.categories);
    } else if (message?.type === "retry-classification") {
      classifier.retry();
      refreshAfterClassification();
    }
  });

  void chrome.runtime.sendMessage({ type: "get-hidden-tweet-categories" })
    .then((response) => applyHiddenCategories(response?.categories))
    .catch(() => applyHiddenCategories([]));

  const observer = new MutationObserver(scheduleUpdate);
  installAnnotationStyles();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  document.addEventListener("visibilitychange", scheduleUpdate);
  scheduleUpdate();
})();
