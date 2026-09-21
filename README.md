# Ungrift

Ungrift is a dependency-free Chrome extension that labels posts as you scroll, lets you hide behavioral categories, and can visually anonymize posters on your **X and LinkedIn feeds** while you record. Settings live in a compact toolbar popover; Ungrift does not display or export the underlying post data.

The extension makes **zero additional requests to X or LinkedIn**. On X, it reads rendered post cards and passively inspects timeline responses the page already requested. On LinkedIn, it reads only the post cards already rendered in the page. Classification batches go directly from the extension background worker to TypeSafe's Jev API.

## Categories

Ungrift makes one primary three-way verdict for each post. **Unclear** is used when the supplied text does not support a responsible judgment.

| Badge | Machine key | Meaning |
| --- | --- | --- |
| **Grift** | `grift` | Appears primarily designed to extract attention, status, money, followers, or influence through manipulation, opportunism, or deceptive presentation. |
| **Good intent** | `good_intent` | Appears to be a sincere attempt to inform, help, discuss, make a case, entertain, or share a viewpoint without deceptive tactics for personal gain. |
| **Unclear** | `unclear` | The available text is insufficient, mixed, or too dependent on missing context to assess responsibly. |

Badges update beside the author as each classification returns. Their tooltip includes the page-session post number, model confidence, and category definition. If either site unmounts and later remounts the same post, its number and cached classification are reused.

### Intent and integrity signals

Ungrift evaluates four independent questions for each post in the same Jev request:

- its primary category;
- its likely communicative intent: `inform`, `push_agenda`, `provoke`, `promote`, `entertain`, or `unclear`;
- the probability that its claims, omissions, or framing create a materially misleading impression;
- the probability that the supplied text itself shows observable signs of strategic deception or bad-faith manipulation.

The badge always leads with the verdict. When the integrity signals cross the configured thresholds, it also surfaces **misleading risk** or **bad-faith risk**, such as **Good intent · misleading risk**. The tooltip shows the verdict confidence, likely communicative intent, and both risk probabilities. These are provisional assessments of the available text; Ungrift does not claim to know an author's private intent or independently verify external facts.

## Install and use

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this repository folder, or run `npm run build` and choose `dist/extension`.
4. Click the Ungrift toolbar icon to open its settings popover.
5. Save your Jev API key. It stays in this Chrome profile and is never synced.
6. Switch on any categories you want hidden, then open or reload `https://x.com/home` or `https://www.linkedin.com/feed/`.

Filter choices persist and are broadcast to every open X and LinkedIn tab. Matching cards disappear as soon as their classification returns. Pending, unavailable, and failed classifications remain visible because they do not yet have a category. **Show all categories** clears all filters, and **Retry** restarts failed classification batches in open feed tabs.

### Recording privacy

Switch on **Anonymize posters** to show only each poster's first name and replace profile photos with a neutral silhouette on X and LinkedIn. The effect is purely presentational: switching it off restores the original page immediately, and Ungrift does not rewrite post data or images at the source. The preference is stored only in the current Chrome profile and is applied to open social tabs without a reload.

## How it works

- On X, a page-world script observes existing `fetch` and `XMLHttpRequest` timeline responses by cloning them locally. The isolated content script matches that structured data to rendered post cards.
- On LinkedIn, the content script recognizes the class-based and SDUI feed layouts. It scopes comments separately from the feed's virtual list, reads marked commentary and actor headers, and separates embedded permalink cards from the sharer's contribution. Stable card keys keep badges attached when posts update.
- Each card receives a stable session number, DOM element ID, and inline category badge.
- Posts are collected into batches of up to eight. Four independent questions per post run together in one Jev request.
- Returned results immediately refresh the badge, category attribute, hide/show decision, and internal classification status together.
- No auto-scroll, social-network API client, background feed polling, profile lookup, analytics, or post-data display is included.

The classifier uses post text, author identity, the available profile bio or LinkedIn headline, and quoted or reshared text as context. Post and referenced text are capped at 6,000 characters each and profile context at 1,600. These are AI assessments of the available contribution, not verified facts about an author.

On LinkedIn, `profileDescription` carries the visible job title or professional headline beneath the author's name. The classifier uses it to interpret relevant experience, hiring context, product affiliations, and promotional interests alongside the post. A title alone cannot establish truth or grift. Missing titles remain unknown; no profile-page requests are made. Shares with commentary use the sharer's headline, while plain reposts use the original author's headline.

On X, the same role-aware assessment uses the author's bio in `profileDescription`, captured from timeline responses the page already requested. Stated job titles, expertise, employers, and product affiliations inform the assessment alongside the post. X does not always supply a bio or a job title; absent roles remain unknown. Quoted authors' bios are kept separate, and plain reposts use the original author's bio.

Both sites use the same classification, badge, filtering, and retry lifecycle. LinkedIn extraction excludes comments, feed controls, and Ungrift's own badges. Posts without identifiable body text show **No text** and remain visible. LinkedIn only supplies text already present in the DOM; Ungrift does not click **see more** or fetch missing content. When the page supplies expanded or edited text, the post is assessed again.

LinkedIn uses a decisive, substance-first verdict rubric. Empty thought leadership, recycled motivational wisdom, authority posturing, jargon dressed as insight, and engagement bait can be **Grift** even without a provable lie or explicit sales pitch. **Good intent** requires useful substance to be the main contribution; token facts do not rescue a mostly empty branding exercise. **Unclear** is reserved for genuinely missing or uninterpretable context. Straightforward job openings, personal milestones, useful promotion, and relevant shares can still qualify as good intent. The separate misleading and bad-faith risk judgments retain their evidence requirements. The background worker selects the rubric from the tab's actual origin and caches the platforms separately.

The rubric distinguishes signup logistics from engagement funnels and explained advice from empty service positioning. Familiar advice can still be useful when it explains a relevant connection or tradeoff. Linked articles, images, and videos are not read: prestige-led teasers and corporate video slogans can be **Grift** based on their visible pitch, without making claims about the unseen destination. A bare link can remain **Unclear**.

For LinkedIn shares with commentary, the sharer's words are the primary contribution and the embedded original is separate reference context. For a plain repost, the original text and original author's available context are assessed. Embedded posts do not receive a second feed entry or badge; nested quotes cannot replace the immediate original's text or author.

The API key is stored in `chrome.storage.local` with access restricted to trusted extension pages. It is never sent to X or LinkedIn or exposed to content scripts. Classification results are cached in memory for up to 2,000 contexts; changing the post text, profile context, or referenced text causes reclassification.

## Development

```bash
npm install
npm run check
npm run build
```

The credential-free distributable is written to `dist/extension` from an explicit runtime allowlist. Development dependencies are used only for tests and are not copied into the extension.

DOM regression tests run the content script and classifier against X, classic LinkedIn, and semantic LinkedIn fixtures. They cover stable badges, filter restoration, retries, cached remounts, edits, recycled cards, and late responses. These tests do not replace a check against an authenticated live feed after a site markup change.

`tests/fixtures/linkedin-rubric.json` contains an 18-case live-model calibration set for fluff, engagement funnels versus signup logistics, substantive promotion, useful advice, hiring, shares, personal updates, promotional teasers, and missing context. Expected labels are review targets, not guarantees; these paid API checks are run manually rather than as part of `npm test`.

```text
manifest.json              Chrome Manifest V3 entry point
icons/                     Toolbar and extension icons
popup/                     Floating settings popover
src/main-world.js          Observes X's existing timeline responses
src/tweet-data.js          Normalizes X response objects
src/linkedin-data.js       Finds and normalizes rendered LinkedIn posts
src/content.js             Labels and filters rendered post cards
src/privacy.js             Visually anonymizes X and LinkedIn post authors
src/background.js          Stores settings and brokers Jev requests
src/classification.js      Rubrics, display labels, batching, and cache
src/jev-client.js          Batched Jev API client
tests/                     Extraction, classification, and packaging tests
```

X and LinkedIn can change their page markup or response shape without notice. Post extraction stays inside the browser; only the collected classification context is sent to TypeSafe. This project is not affiliated with X or LinkedIn.
