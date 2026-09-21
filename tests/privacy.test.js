"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { anonymizedName } = require("../src/privacy.js");

function privacyPage(t, { hostname, markup }) {
  const { document, window } = parseHTML(`<!doctype html><html><head></head><body><main>${markup}</main></body></html>`);
  const timers = new Map();
  const observers = [];
  let messageListener;
  let nextTimer = 1;
  const sandbox = vm.createContext({
    document,
    window,
    Node: window.Node,
    location: { hostname },
    getComputedStyle: () => ({ color: "rgb(25, 25, 25)" }),
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class extends window.MutationObserver {
      constructor(fn) { super(fn); observers.push(this); }
    },
    chrome: { runtime: {
      onMessage: { addListener(fn) { messageListener = fn; } },
      async sendMessage() { return { enabled: true }; }
    } }
  });
  const files = hostname.includes("linkedin") ? ["linkedin-data.js", "privacy.js"] : ["privacy.js"];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(`${__dirname}/../src/${file}`, "utf8"), sandbox, { filename: file });
  }
  t.after(() => observers.forEach((observer) => observer.disconnect()));
  return {
    document,
    disable() { messageListener({ type: "apply-anonymize-social-posters", enabled: false }); },
    async settle() {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach((fn) => fn());
        if (!timers.size) await Promise.resolve();
      }
    }
  };
}

test("privacy display keeps only a first name when a surname is present", () => {
  assert.equal(anonymizedName("Ada Lovelace"), "Ada •••");
  assert.equal(anonymizedName("María José García"), "María •••");
  assert.equal(anonymizedName("  Grace   Brewster Murray Hopper  "), "Grace •••");
});

test("privacy display skips honorifics when choosing the visible first name", () => {
  assert.equal(anonymizedName("Dr. Mae Jemison"), "Mae •••");
  assert.equal(anonymizedName("Professor Stephen Hawking"), "Stephen •••");
});

test("privacy display leaves mononyms unchanged", () => {
  assert.equal(anonymizedName("Madonna"), "Madonna");
  assert.equal(anonymizedName(" "), "");
});

for (const variant of [
  {
    name: "X",
    hostname: "x.com",
    markup: `<article data-testid="tweet"><div data-testid="Tweet-User-Avatar"><span><img alt="Ada"></span></div>
      <div data-testid="User-Name"><a href="/ada"><span>Ada Lovelace</span></a><a href="/ada">@ada</a></div></article>`
  },
  {
    name: "LinkedIn classic",
    hostname: "www.linkedin.com",
    markup: `<div class="feed-shared-update-v2" data-id="urn:li:activity:100">
      <div class="update-components-actor"><a href="/in/ada"><img alt="Ada"></a>
      <div class="update-components-actor__name">Ada Lovelace</div></div>
      <div class="update-components-text">A post.</div></div>`
  },
  {
    name: "LinkedIn semantic",
    hostname: "www.linkedin.com",
    markup: `<div role="listitem" data-id="urn:li:activity:100">
      <a href="/in/ada"><img alt="Ada"><span>Ada Lovelace</span></a><p>A post.</p>
      <button aria-label="Comment on this post">Comment</button></div>`
  },
  {
    name: "LinkedIn SDUI",
    hostname: "www.linkedin.com",
    markup: `<div role="list" data-component-type="LazyColumn"><div role="listitem" componentkey="update-card-focus100">
      <a href="/in/ada"><img alt="Ada"><p>Ada Lovelace</p><p> • 2nd</p></a>
      <span data-testid="expandable-text-box">A post.</span>
      <button aria-label="Reaction button state: no reaction">Like</button></div></div>`
  }
]) {
  test(`${variant.name} poster privacy is visual and reversible`, async (t) => {
    const page = privacyPage(t, variant);
    await page.settle();
    const name = page.document.querySelector(".ungrift-private-name");
    assert.equal(name?.dataset.ungriftAnonymizedName, "Ada •••");
    if (variant.name === "X") {
      const handle = page.document.querySelector(".ungrift-private-handle");
      assert.equal(handle?.dataset.ungriftAnonymizedHandle, "@•••");
      assert.equal(handle.textContent, "@ada", "The source handle stays in the DOM");
    }
    assert.ok(page.document.querySelector("img").classList.contains("ungrift-private-avatar"));
    assert.ok(page.document.documentElement.hasAttribute("data-ungrift-anonymize-posters"));
    page.disable();
    assert.ok(!page.document.documentElement.hasAttribute("data-ungrift-anonymize-posters"));
    assert.match(name.textContent, /Ada Lovelace/, "The source name stays in the DOM");
  });
}
