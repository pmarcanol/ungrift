(function exposeLinkedInData(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    Object.defineProperty(root, "__UNGRIFT_LINKEDIN_DATA__", {
      configurable: true,
      value: api
    });
  }
})(globalThis, function createLinkedInData() {
  "use strict";

  const POST_ROOT_SELECTOR = [
    ".feed-shared-update-v2",
    ".occludable-update",
    '[data-view-name="feed-full-update"]',
    'main [role="listitem"]',
    'div[data-urn*="urn:li:activity:"]',
    'div[data-urn*="urn:li:share:"]',
    'div[data-urn*="urn:li:ugcPost:"]',
    'div[data-id*="urn:li:activity:"]',
    'div[data-id*="urn:li:share:"]',
    'div[data-id*="urn:li:ugcPost:"]'
  ].join(", ");

  const STABLE_ROOT_SELECTOR = [
    ".feed-shared-update-v2",
    ".occludable-update",
    '[data-view-name="feed-full-update"]',
    'main [role="listitem"]'
  ].join(", ");

  const SHARED_CONTENT_SELECTOR = [
    ".feed-shared-update-v2__reshared-content",
    ".update-components-update-v2__reshared-content",
    ".update-components-mini-update-v2",
    ".feed-shared-mini-update-v2"
  ].join(", ");

  const BODY_SELECTORS = [
    '[data-testid="expandable-text-box"]',
    '[data-test-id="main-feed-activity-card__commentary"]',
    '[data-testid="main-feed-activity-card__commentary"]',
    ".feed-shared-update-v2__description",
    ".update-components-text",
    ".feed-shared-text",
    ".feed-shared-inline-show-more-text"
  ];

  const AUTHOR_NAME_SELECTORS = [
    '[data-test-id="main-feed-activity-card__actor-name"]',
    '[data-testid="main-feed-activity-card__actor-name"]',
    ".update-components-actor__name .visually-hidden",
    ".update-components-actor__name span[aria-hidden=\"true\"]",
    ".update-components-actor__title .visually-hidden",
    ".update-components-actor__title span[aria-hidden=\"true\"]",
    ".update-components-actor__name",
    ".update-components-actor__title"
  ];

  const AUTHOR_DESCRIPTION_SELECTORS = [
    '[data-test-id="main-feed-activity-card__actor-description"]',
    '[data-testid="main-feed-activity-card__actor-description"]',
    ".update-components-actor__description .visually-hidden",
    ".update-components-actor__description span[aria-hidden=\"true\"]",
    ".update-components-actor__subtitle .visually-hidden",
    ".update-components-actor__description",
    ".update-components-actor__subtitle"
  ];

  const BADGE_HOST_SELECTORS = [
    '[data-test-id="main-feed-activity-card__actor-name"]',
    '[data-testid="main-feed-activity-card__actor-name"]',
    ".update-components-actor__name",
    ".update-components-actor__title"
  ];

  const URN_PATTERN = /urn:li:(?:activity|share|ugcPost):[A-Za-z0-9_-]+/i;
  // LazyColumn also renders the entire SDUI feed. Only nested lists inside a
  // post are comment lists; excluding every LazyColumn excludes every post.
  const COMMENTS = ':is(.feed-shared-update-v2, .occludable-update, [role="listitem"], [data-view-name="feed-full-update"]) [data-component-type="LazyColumn"], [componentkey^="commentsSectionContainer"], [componentkey^="replaceableComment"], .comments-comment-entity, .comments-comments-list, .comments-comment-item';
  const SOCIAL_HEADER = '.update-components-header, .feed-shared-header, p:has([data-sdui-anchor-id^="feed-header-"])';
  const CHROME = [COMMENTS, '.ungrift-label', '.ungrift-badge-anchor', 'button', '[role="button"]',
    'nav', 'footer', 'input', 'textarea', '[contenteditable="true"]', 'script', 'style',
    'video', 'iframe', '[role="menu"]', '[role="dialog"]', '.social-details-social-counts',
    '.feed-shared-social-action-bar', '.update-components-header', '.feed-shared-header',
    '.update-components-actor', '.feed-shared-actor', ...BADGE_HOST_SELECTORS,
    ...AUTHOR_DESCRIPTION_SELECTORS].join(', ');

  function cleanText(value) {
    return typeof value === "string"
      ? value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
      : null;
  }

  function postUrnFromValue(value) {
    if (typeof value !== "string") return null;
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* Keep the original value. */ }
    const urn = decoded.match(URN_PATTERN)?.[0];
    if (urn) return urn;
    const permalink = decoded.match(/\/posts\/[^/?]*-(activity|share|ugcPost)-(\d+)(?:-|[/?]|$)/i);
    return permalink ? `urn:li:${permalink[1]}:${permalink[2]}` : null;
  }

  // Read detached text so hiding a card cannot change its classification context.
  // Never feed our own badges (or "see more" controls) back into the classifier.
  function sourceText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(`${COMMENTS}, .ungrift-label, .ungrift-badge-anchor, button, [role="button"], script, style`)
      .forEach((child) => child.remove());
    if (clone.querySelector('[aria-hidden="true"]')) {
      clone.querySelectorAll('.visually-hidden').forEach((child) => child.remove());
    }
    clone.querySelectorAll('br').forEach((child) => child.replaceWith('\n'));
    clone.querySelectorAll('p, div, blockquote').forEach((child) => child.append('\n'));
    return cleanText(clone.textContent) || null;
  }

  function textFromFirst(root, selectors, accept = () => true) {
    for (const selector of selectors) {
      const nodes = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
      for (const node of nodes) {
        if (node.closest(`${COMMENTS}, ${SOCIAL_HEADER}`)) continue;
        const text = sourceText(node);
        if (text && accept(node, text)) return { node, text };
      }
    }
    return null;
  }

  function ownUrn(node) {
    return postUrnFromValue(node.getAttribute("data-urn")) || postUrnFromValue(node.getAttribute("data-id"));
  }

  function hasTextOutside(root, excluded) {
    function visit(node) {
      if (node === excluded) return false;
      if (node.nodeType === 3) return Boolean(node.textContent.trim());
      if (node !== root && node.matches?.(CHROME)) return false;
      return [...node.childNodes].some(visit);
    }
    return visit(root);
  }

  function sharedRoots(root, isReference) {
    const actors = [...root.querySelectorAll(`${BADGE_HOST_SELECTORS.join(', ')}, a[href*="/in/"], a[href*="/company/"]`)]
      .filter((node) => !node.closest(`${COMMENTS}, ${SOCIAL_HEADER}`));
    const semanticReferences = [];
    const actorLinks = [...root.querySelectorAll('a[href*="/in/"]:has(p), a[href*="/company/"]:has(p)')]
      .filter((node) => !node.closest(`${COMMENTS}, ${SOCIAL_HEADER}`));
    // SDUI quotes have no reshared class or nested list item. Their commentary
    // is wrapped in a permalink; its nearest actor-containing parent is the quote.
    for (const link of root.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]')) {
      if (link.closest(COMMENTS) || !link.querySelector('[data-testid="expandable-text-box"]')) continue;
      for (let wrapper = link.parentElement; wrapper && wrapper !== root; wrapper = wrapper.parentElement) {
        if (!actorLinks.some((actor) => wrapper.contains(actor))) continue;
        if (actorLinks.some((actor) => !wrapper.contains(actor))) semanticReferences.push(wrapper);
        break;
      }
    }
    const candidates = [...new Set([...root.querySelectorAll(
      `${SHARED_CONTENT_SELECTOR}, ${POST_ROOT_SELECTOR}, .feed-shared-update-v2__update-content-wrapper`
    ), ...semanticReferences])].filter((node) => {
      if (node.closest(COMMENTS)) return false;
      const separateAuthor = actors.some((actor) => !node.contains(actor) && !actor.contains(node));
      if (node.matches(SHARED_CONTENT_SELECTOR)) {
        // Several shared/mini-update wrappers can represent the SAME original.
        // Only split again if this level has its own contribution or author.
        return !isReference || separateAuthor || hasTextOutside(root, node);
      }
      // A normal update-content wrapper is not a quote. Require an independent
      // author section, plus a different post ID or an author outside the wrapper.
      if (!actors.some((actor) => node.contains(actor))) return false;
      const distinctId = ownUrn(root) && ownUrn(node) && ownUrn(root) !== ownUrn(node);
      return distinctId || separateAuthor;
    });
    return candidates.filter((node) => !candidates.some((parent) => parent !== node && parent.contains(node)));
  }

  function scopedView(root, isReference = false) {
    const references = sharedRoots(root, isReference);
    const clone = root.cloneNode(true);
    const originalNodes = [root, ...root.querySelectorAll('*')];
    const clonedNodes = [clone, ...clone.querySelectorAll('*')];
    const originals = new WeakMap(clonedNodes.map((node, index) => [node, originalNodes[index]]));
    const excluded = new Set(references);
    // Remove references before ANY selector lookup, including author and ID
    // lookup. Ancestor textContent must never mix two authors' contributions.
    for (const node of clonedNodes.slice(1)) {
      if (excluded.has(originals.get(node))) node.remove();
    }
    clone.querySelectorAll(`${COMMENTS}, ${SOCIAL_HEADER}`).forEach((node) => node.remove());
    return { root: clone, references, original: (node) => node ? originals.get(node) : null };
  }

  function scopedPostText(root) {
    const direct = textFromFirst(root, BODY_SELECTORS);
    if (direct) return direct.text;
    // SDUI explicitly marks commentary. Without it, a card may be media-only;
    // its headline, timestamps and engagement counts are not post text.
    if (root.matches('[componentkey^="update-card-focus"]')) return null;

    // Semantic feeds have no stable classes. Strip non-post regions BEFORE
    // inspecting text blocks; ranking arbitrary wrappers by length captures comments.
    const clone = root.cloneNode(true);
    clone.querySelectorAll(CHROME).forEach((node) => node.remove());
    const author = profileLink(clone);
    if (author) {
      let header = author;
      // Only remove a header wrapper when it contains no independent text block.
      while (header.parentElement && header.parentElement !== clone &&
          ![...header.parentElement.querySelectorAll('p, blockquote, [dir]')]
            .some((node) => node !== header && !header.contains(node))) {
        header = header.parentElement;
      }
      header.remove();
    }
    const candidates = [...clone.querySelectorAll('p, blockquote, [dir="ltr"], [dir="rtl"], [dir="auto"]')]
      .filter((node) => !node.closest('a') && !node.querySelector('video, iframe'));
    const blocks = candidates.filter((node) => !candidates.some((parent) => parent !== node && parent.contains(node)));
    return cleanText(blocks.map(sourceText).filter(Boolean).join('\n')) || null;
  }

  function authorNameFromProfileLink(post) {
    for (const link of post.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')) {
      if (link.closest(`${COMMENTS}, ${SOCIAL_HEADER}`)) continue;
      const text = sourceText(link);
      if (text && text.length > 1 && text.length < 100 && !/^(?:view|follow|connect)$/i.test(text)) {
        return text.replace(/\s+View profile.*$/i, "").trim();
      }
      const label = link.getAttribute("aria-label") || "";
      const labelMatch = label.match(/(?:View\s+)?(.+?)(?:'s|’s)\s+(?:profile|graphic)/i);
      if (labelMatch) return cleanText(labelMatch[1]);
    }
    return null;
  }

  function authorName(post) {
    const named = textFromFirst(post, AUTHOR_NAME_SELECTORS);
    if (named) return named.text.replace(/\s+(?:View profile|\d+(?:st|nd|rd|th))\s*$/i, "").trim();

    const semantic = semanticActor(post);
    if (semantic) return semantic.name;

    const follow = [...post.querySelectorAll('button[aria-label^="Follow "]')]
      .find((node) => !node.closest(`${COMMENTS}, ${SOCIAL_HEADER}`));
    const followedName = follow?.getAttribute("aria-label")?.match(/^Follow\s+(.+)$/i)?.[1];
    return cleanText(followedName) || authorNameFromProfileLink(post);
  }

  function profileDescription(post) {
    return textFromFirst(post, AUTHOR_DESCRIPTION_SELECTORS)?.text || semanticActor(post)?.description || null;
  }

  function semanticActor(post) {
    // SDUI actor links wrap the name and connection degree in separate p tags.
    // Inline mentions and social attribution links do not have this structure.
    for (const link of post.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')) {
      if (link.closest(`${COMMENTS}, ${SOCIAL_HEADER}`)) continue;
      const nameNode = link.querySelector('p');
      const name = nameNode && sourceText(nameNode);
      if (!name) continue;
      let description = null;
      for (let header = link.parentElement; header && header !== post; header = header.parentElement) {
        if (header.querySelector('[data-testid="expandable-text-box"], button[aria-label*="Reaction"]')) break;
        const paragraph = [...header.querySelectorAll('p')].find((node) => !link.contains(node));
        if (!paragraph) continue;
        const value = sourceText(paragraph);
        if (value && !/^(?:Promoted|\d+[hmdwy]\b|\d[\d,.]* followers)/i.test(value)) description = value;
        break;
      }
      return { name, description, link };
    }
    return null;
  }

  function postUrn(post) {
    for (const attribute of ["data-urn", "data-id"]) {
      const ownUrn = postUrnFromValue(post.getAttribute(attribute));
      if (ownUrn) return ownUrn;
    }
    for (const attribute of ["data-urn", "data-id"]) {
      for (const node of post.querySelectorAll(`[${attribute}*="urn:li:"]`)) {
        if (node.closest(COMMENTS)) continue;
        const urn = postUrnFromValue(node.getAttribute(attribute));
        if (urn) return urn;
      }
    }

    for (const link of post.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]')) {
      if (link.closest(COMMENTS)) continue;
      const urn = postUrnFromValue(link.getAttribute("href"));
      if (urn) return urn;
    }
    return null;
  }

  function badgeHost(post) {
    for (const selector of BADGE_HOST_SELECTORS) {
      const node = [...post.querySelectorAll(selector)].find((candidate) =>
        !candidate.closest(COMMENTS)
      );
      if (node) return node;
    }

    return semanticActor(post)?.link || profileLink(post);
  }

  function profileLink(post) {
    return [...post.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')].find((link) =>
      !link.closest(`${COMMENTS}, ${SOCIAL_HEADER}`) && sourceText(link)
    ) || null;
  }

  function looksLikePost(node) {
    const urn = postUrn(node);
    const hasIdentity = Boolean(urn || node.querySelector('a[href*="/in/"], a[href*="/company/"]'));
    if (node.matches('[componentkey^="update-card-focus"]')) {
      // Recommendations also use update-card-focus and Follow buttons.
      return hasIdentity && Boolean(node.querySelector(
        'button[aria-label^="Open control menu for post by "], button[aria-label^="Reaction button"]'
      ));
    }
    const hasPostAction = Boolean(node.querySelector(
      'button[aria-label^="Comment"], button[aria-label*="React"], button[aria-label^="Like"], button[aria-label^="Follow "]'
    ));
    return hasIdentity && Boolean(urn || hasPostAction);
  }

  function normalizedRoot(candidate) {
    if (candidate.matches?.(STABLE_ROOT_SELECTOR)) return candidate;
    return candidate.closest?.(STABLE_ROOT_SELECTOR) || candidate;
  }

  function findPostElements(documentRoot) {
    const posts = [];
    for (const candidate of documentRoot.querySelectorAll(POST_ROOT_SELECTOR)) {
      if (candidate.closest(COMMENTS) || candidate.closest(SHARED_CONTENT_SELECTOR)) continue;
      const post = normalizedRoot(candidate);
      if (!looksLikePost(post)) continue;
      if (posts.some((existing) => existing === post || existing.contains(post))) continue;

      const nestedIndexes = posts.flatMap((existing, index) => post.contains(existing) ? [index] : []);
      for (const index of nestedIndexes.reverse()) posts.splice(index, 1);
      posts.push(post);
    }
    return posts;
  }

  function extractPost(post) {
    const isRepost = [...post.querySelectorAll(SOCIAL_HEADER)].some((node) => /\breposted\b/i.test(node.textContent));
    const main = scopedView(post);
    const shared = main.references[0] ? scopedView(main.references[0], true) : null;
    let referencedContent = shared ? scopedPostText(shared.root) : null;
    const commentary = scopedPostText(main.root);
    const content = commentary || referencedContent;
    if (!referencedContent && isRepost) referencedContent = content;
    // As on X, a plain repost is assessed using the original author's context.
    const author = !commentary && shared ? shared : main;
    const handle = authorName(author.root);
    if (!handle && !content) return null;

    const urn = postUrn(main.root);
    const componentKey = post.getAttribute('componentkey');
    return {
      key: urn ? `linkedin:${urn}` : componentKey?.startsWith('update-card-focus')
        ? `linkedin:card:${componentKey}` : `linkedin:${handle || "unknown"}:${content || ""}`,
      handle,
      content,
      profileDescription: profileDescription(author.root),
      citedOrRetweetedTweetContent: referencedContent,
      badgeHost: author.original(badgeHost(author.root))
    };
  }

  return {
    POST_ROOT_SELECTOR,
    SHARED_CONTENT_SELECTOR,
    cleanText,
    postUrnFromValue,
    findPostElements,
    extractPost
  };
});
