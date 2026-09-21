"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHTML } = require("linkedom");
const {
  postUrnFromValue, findPostElements, extractPost
} = require("../src/linkedin-data.js");

function documentFor(markup) {
  return parseHTML(`<!doctype html><html><body>${markup}</body></html>`).document;
}

// Reduced from the authenticated SDUI feed: the feed itself is a LazyColumn,
// actor names/degrees are separate paragraphs, and quote bodies are permalinks.
function sduiActor(name, slug, headline = "Author headline") {
  return `<div><div><a href="/in/${slug}"><div aria-label="${name} 2nd"><p>${name}</p><p> • 2nd</p></div></a></div>
    <div><p>${headline}</p></div><div><p>4d •</p></div><a href="/in/${slug}"></a></div>`;
}

function sduiFeed(contents) {
  return documentFor(`<main><div role="list" data-testid="mainFeed" data-component-type="LazyColumn">
    <div role="listitem" componentkey="update-card-focusouterFeedType_MAIN_FEED_RELEVANCE">
      <div data-display-contents="true"><div><h2>Feed post</h2>${contents}
      <button aria-label="Reaction button state: no reaction">Like</button><button>Comment</button></div></div>
    </div></div></main>`);
}

test("live SDUI feed LazyColumn is not a comment list; attribution and comments stay out of context", () => {
  const document = sduiFeed(`<p><a href="/in/reposter"><span data-sdui-anchor-id="feed-header-123">Reposter</span></a> reposted this</p>
    ${sduiActor("Original Author", "original")}
    <p><span data-testid="expandable-text-box">Original first line.<br>Second line.<button>… more</button></span></p>
    <div componentkey="commentsSectionContainer123"><div data-component-type="LazyColumn">
      <div role="listitem">${sduiActor("Commenter", "commenter")}
      <span data-testid="expandable-text-box">Unrelated comment.</span></div></div></div>`);
  const cards = findPostElements(document);
  assert.equal(cards.length, 1);
  const post = extractPost(cards[0]);
  assert.equal(post.handle, "Original Author");
  assert.equal(post.profileDescription, "Author headline");
  assert.equal(post.content, "Original first line.\nSecond line.");
  assert.equal(post.citedOrRetweetedTweetContent, post.content);
  assert.equal(post.badgeHost.getAttribute("href"), "/in/original");
});

test("live SDUI share separates unmarked quote wrappers and never borrows the original's ID", () => {
  const document = sduiFeed(`${sduiActor("Sharer", "sharer", "Sharer headline")}
    <p><span data-testid="expandable-text-box">You want to work with this person.</span></p>
    <div>${sduiActor("Original", "original", "Original headline")}
      <a href="/feed/update/urn:li:share:123/"><p><span data-testid="expandable-text-box">Our team is hiring.<br>Apply here.</span></p></a>
    </div>`);
  const cards = findPostElements(document);
  assert.equal(cards.length, 1);
  const post = extractPost(cards[0]);
  assert.equal(post.handle, "Sharer");
  assert.equal(post.profileDescription, "Sharer headline");
  assert.equal(post.content, "You want to work with this person.");
  assert.equal(post.citedOrRetweetedTweetContent, "Our team is hiring.\nApply here.");
  assert.equal(post.key, "linkedin:card:update-card-focusouterFeedType_MAIN_FEED_RELEVANCE");
  document.querySelector('[data-testid="expandable-text-box"]').textContent = "Updated recommendation.";
  assert.equal(extractPost(cards[0]).key, post.key);
  assert.equal(post.badgeHost.getAttribute("href"), "/in/sharer");
});

test("SDUI media-only posts cannot classify author metadata or engagement text", () => {
  const document = sduiFeed(`${sduiActor("Author", "author")}<img alt="Photo"><p>100 reactions</p>`);
  const post = extractPost(findPostElements(document)[0]);
  assert.equal(post.handle, "Author");
  assert.equal(post.content, null);
});

test("SDUI follow recommendations are not feed posts", () => {
  const document = documentFor(`<main><div role="listitem" componentkey="update-card-focusrecommendations">
    <h2>Feed post</h2><p>Recommended for you</p>${sduiActor("Suggested person", "suggested")}
    <button aria-label="Follow Suggested person">Follow</button></div></main>`);
  assert.equal(findPostElements(document).length, 0);
});

test("shared content inside a commentary wrapper is never read as the sharer's words", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:900">
    <div class="update-components-actor__name">Sharer</div>
    <div class="feed-shared-update-v2__description">I disagree with this claim.
      <div class="feed-shared-update-v2__reshared-content">
        <div class="update-components-actor__name">Original</div>
        <div class="update-components-text">The claim being challenged.</div>
      </div>
    </div></div></main>`);
  const post = extractPost(findPostElements(document)[0]);
  assert.equal(post.content, "I disagree with this claim.");
  assert.equal(post.handle, "Sharer");
  assert.equal(post.citedOrRetweetedTweetContent, "The claim being challenged.");
});

test("generic update-content wrappers with an independent author identify embedded posts", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:901">
    <div class="update-components-actor__name">Sharer</div>
    <p dir="ltr">My own perspective.</p>
    <div class="feed-shared-update-v2__update-content-wrapper">
      <div class="update-components-actor__name">Original</div>
      <div class="update-components-actor__description">Original bio</div>
      <div class="update-components-text">The original contribution.</div>
    </div></div></main>`);
  const post = extractPost(findPostElements(document)[0]);
  assert.equal(post.content, "My own perspective.");
  assert.equal(post.handle, "Sharer");
  assert.equal(post.profileDescription, null, "Do not borrow the quoted author's bio");
  assert.equal(post.citedOrRetweetedTweetContent, "The original contribution.");
});

test("semantic shared cards remain separate even without legacy reshared CSS classes", () => {
  const document = documentFor(`<main><div role="listitem" data-id="urn:li:activity:902">
    <a href="/in/sharer">Sharer</a><p dir="ltr">I disagree.</p>
    <div data-view-name="feed-full-update" data-id="urn:li:activity:903">
      <a href="/in/original">Original</a><p dir="ltr">Quoted argument.</p>
    </div><button aria-label="Comment on this post">Comment</button>
  </div></main>`);
  const cards = findPostElements(document);
  assert.equal(cards.length, 1);
  const post = extractPost(cards[0]);
  assert.equal(post.key, "linkedin:urn:li:activity:902");
  assert.equal(post.handle, "Sharer");
  assert.equal(post.content, "I disagree.");
  assert.equal(post.citedOrRetweetedTweetContent, "Quoted argument.");
});

test("plain reposts with a body wrapper retain the original author's identity and badge host", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:904">
    <div class="update-components-header">Someone reposted this</div>
    <div class="feed-shared-update-v2__description">
      <div class="feed-shared-update-v2__reshared-content">
        <div class="update-components-actor__name">Original</div>
        <div class="update-components-actor__description">Original bio</div>
        <div class="update-components-text">Original words.</div>
      </div>
    </div></div></main>`);
  const card = findPostElements(document)[0];
  const post = extractPost(card);
  assert.equal(post.handle, "Original");
  assert.equal(post.content, "Original words.");
  assert.equal(post.profileDescription, "Original bio");
  assert.equal(post.citedOrRetweetedTweetContent, "Original words.");
  assert.ok(card.contains(post.badgeHost), "The badge must point to the live author, not a clone");
});

test("nested quote selectors cannot outrank the immediate original post's text", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:905">
    <div class="update-components-actor__name">Sharer</div><div class="update-components-text">My words.</div>
    <div class="feed-shared-update-v2__reshared-content">
      <p dir="ltr">Immediate original words.</p>
      <div class="update-components-mini-update-v2"><div class="feed-shared-update-v2__description">Deeper quote.</div></div>
    </div></div></main>`);
  const post = extractPost(findPostElements(document)[0]);
  assert.equal(post.content, "My words.");
  assert.equal(post.citedOrRetweetedTweetContent, "Immediate original words.");
});

test("nested reshared/mini-update wrappers around one original are not separate quotes", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:906">
    <div class="update-components-actor__name">Sharer</div><div class="update-components-text">My words.</div>
    <div class="feed-shared-update-v2__reshared-content">
      <div class="update-components-mini-update-v2">
        <div class="update-components-actor__name">Original</div>
        <div class="update-components-text">Original words.</div>
      </div>
    </div></div></main>`);
  const post = extractPost(findPostElements(document)[0]);
  assert.equal(post.content, "My words.");
  assert.equal(post.citedOrRetweetedTweetContent, "Original words.");
});

test("badge updates cannot change the author's classification context", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:1">
    <div class="update-components-actor__name">Ada Lovelace</div>
    <div class="update-components-text">We should learn more</div>
  </div></main>`);
  const card = findPostElements(document)[0];
  const before = extractPost(card);
  before.badgeHost.insertAdjacentHTML("beforeend", '<span class="ungrift-label">Classifying…</span>');
  const after = extractPost(card);
  assert.equal(after.handle, before.handle);
  assert.equal(after.content, "We should learn more");
});

test("semantic extraction excludes comments, author headers, controls, and our badges", () => {
  const document = documentFor(`<main><div role="listitem" data-id="urn:li:activity:2">
    <div><a href="/in/ada">Ada Lovelace</a><button aria-label="Follow Ada Lovelace">Follow</button></div>
    <div><p dir="ltr">Short post.</p><p dir="ltr">Second paragraph.</p></div>
    <button aria-label="Comment on this post">Comment</button>
    <div data-component-type="LazyColumn"><div role="listitem"><a href="/in/commenter">Commenter</a>
      <div class="update-components-text">${"A long comment is not the post. ".repeat(40)}</div>
    </div></div>
  </div></main>`);
  const cards = findPostElements(document);
  assert.equal(cards.length, 1);
  assert.equal(extractPost(cards[0]).content, "Short post.\nSecond paragraph.");
});

test("media-only posts remain unavailable instead of classifying header or comment text", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:3">
    <div class="update-components-actor"><div class="update-components-actor__name">Ada Lovelace</div>
      <div class="update-components-actor__description">A long professional headline</div></div>
    <img alt="A photograph"><button aria-label="Comment on this post">Comment</button>
    <div class="comments-comment-entity"><div class="update-components-text">This is a comment.</div></div>
  </div></main>`);
  const cards = findPostElements(document);
  assert.equal(cards.length, 1);
  assert.equal(extractPost(cards[0]).content, null);
});

test("commentary wrappers are not quotes; nested references cannot supply the outer ID", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:4">
    <div class="update-components-actor__name">Ada Lovelace</div>
    <div class="feed-shared-update-v2__update-content-wrapper"><div class="update-components-text">My commentary</div></div>
    <div class="feed-shared-update-v2__reshared-content" data-urn="urn:li:activity:5">
      <div class="update-components-text">Their original post</div></div>
  </div></main>`);
  const extracted = extractPost(findPostElements(document)[0]);
  assert.equal(extracted.key, "linkedin:urn:li:activity:4");
  assert.equal(extracted.content, "My commentary");
  assert.equal(extracted.citedOrRetweetedTweetContent, "Their original post");
});

test("recognizes LinkedIn activity, share, and ugcPost identifiers in URLs", () => {
  assert.equal(
    postUrnFromValue("https://www.linkedin.com/feed/update/urn:li:activity:12345/"),
    "urn:li:activity:12345"
  );
  assert.equal(
    postUrnFromValue("/feed/update/urn%3Ali%3AugcPost%3Aabc_123?commentUrn=x"),
    "urn:li:ugcPost:abc_123"
  );
  assert.equal(postUrnFromValue("/in/example"), null);
  assert.equal(postUrnFromValue("/posts/ada-computing-activity-12345-abcd"), "urn:li:activity:12345");
});

test("a pure repost uses the original author's context and excludes social attribution", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-id="urn:li:activity:6">
    <div class="update-components-header"><a href="/in/reposter">Reposter</a> reposted this</div>
    <div class="feed-shared-update-v2__reshared-content" data-urn="urn:li:activity:7">
      <div class="update-components-actor__name">Original Author</div>
      <div class="update-components-actor__description">Original Headline</div>
      <div class="update-components-text">Original contribution.</div>
    </div></div></main>`);
  const card = findPostElements(document)[0];
  const extracted = extractPost(card);
  assert.equal(extracted.key, "linkedin:urn:li:activity:6");
  assert.equal(extracted.handle, "Original Author");
  assert.equal(extracted.profileDescription, "Original Headline");
  assert.equal(extracted.content, "Original contribution.");
  assert.equal(extracted.citedOrRetweetedTweetContent, extracted.content);
});

test("no-text cards are detected without inventing body text from the headline", () => {
  const document = documentFor(`<main><div class="feed-shared-update-v2" data-urn="urn:li:activity:8">
    <div class="update-components-actor"><div class="update-components-actor__name">Author</div>
      <p class="update-components-actor__description">This headline is not a post</p></div>
    <img alt="Photo"></div></main>`);
  assert.equal(findPostElements(document).length, 1);
  assert.equal(extractPost(findPostElements(document)[0]).content, null);
});

test("extracts a class-based LinkedIn post and its reshared context", () => {
  const document = documentFor(`
    <main>
      <div class="feed-shared-update-v2" data-urn="urn:li:activity:101">
        <div class="update-components-actor">
          <div class="update-components-actor__name"><span aria-hidden="true">Ada Lovelace</span></div>
          <div class="update-components-actor__description"><span aria-hidden="true">Founder at Analytical Engines</span></div>
        </div>
        <div class="feed-shared-update-v2__description">A careful argument about computing.</div>
        <div class="feed-shared-update-v2__reshared-content">
          <div class="update-components-text">The original post being discussed.</div>
        </div>
        <button aria-label="Comment on Ada Lovelace's post">Comment</button>
      </div>
    </main>
  `);

  const posts = findPostElements(document);
  assert.equal(posts.length, 1);
  const extracted = extractPost(posts[0]);
  assert.equal(extracted.key, "linkedin:urn:li:activity:101");
  assert.equal(extracted.handle, "Ada Lovelace");
  assert.equal(extracted.profileDescription, "Founder at Analytical Engines");
  assert.equal(extracted.content, "A careful argument about computing.");
  assert.equal(extracted.citedOrRetweetedTweetContent, "The original post being discussed.");
  assert.equal(extracted.badgeHost.className, "update-components-actor__name");
});

test("extracts LinkedIn's semantic feed layout and deduplicates nested URN nodes", () => {
  const document = documentFor(`
    <main>
      <div role="listitem">
        <div data-id="urn:li:share:202">
          <a href="/in/grace-hopper"><span>Grace Hopper</span></a>
          <div data-test-id="main-feed-activity-card__commentary">Compilers make programming accessible.</div>
          <button aria-label="Follow Grace Hopper">Follow</button>
          <button aria-label="React to this post">Like</button>
          <button aria-label="Comment on this post">Comment</button>
        </div>
      </div>
    </main>
  `);

  const posts = findPostElements(document);
  assert.equal(posts.length, 1);
  const extracted = extractPost(posts[0]);
  assert.equal(extracted.key, "linkedin:urn:li:share:202");
  assert.equal(extracted.handle, "Grace Hopper");
  assert.equal(extracted.content, "Compilers make programming accessible.");
  assert.equal(extracted.badgeHost.getAttribute("href"), "/in/grace-hopper");
});

test("uses reshared text as the content of a repost without added commentary", () => {
  const document = documentFor(`
    <main>
      <div class="occludable-update" data-id="urn:li:activity:303">
        <a href="/company/example">Example Labs</a>
        <div class="update-components-update-v2__reshared-content">
          <p dir="ltr">A useful announcement from the original author.</p>
        </div>
        <button aria-label="Comment on this post">Comment</button>
      </div>
    </main>
  `);

  const extracted = extractPost(findPostElements(document)[0]);
  assert.equal(extracted.content, "A useful announcement from the original author.");
  assert.equal(extracted.citedOrRetweetedTweetContent, extracted.content);
});
