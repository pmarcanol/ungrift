# Ungrift

Ungrift is a dependency-free Chrome extension that labels posts as you scroll, lets you hide behavioral categories from your X timeline, and can visually anonymize posters on X and LinkedIn while you record. Settings live in a compact toolbar popover; Ungrift does not display or export the underlying post data.

The extension makes **zero additional requests to X**. It reads rendered tweet cards and passively inspects timeline responses X already requested. Classification batches go directly from the extension background worker to TypeSafe's Jev API.

## Categories

Ungrift makes one primary three-way verdict for each post. **Unclear** is used when the supplied text does not support a responsible judgment.

| Badge | Machine key | Meaning |
| --- | --- | --- |
| **Grift** | `grift` | Appears primarily designed to extract attention, status, money, followers, or influence through manipulation, opportunism, or deceptive presentation. |
| **Good intent** | `good_intent` | Appears to be a sincere attempt to inform, help, discuss, make a case, entertain, or share a viewpoint without deceptive tactics for personal gain. |
| **Unclear** | `unclear` | The available text is insufficient, mixed, or too dependent on missing context to assess responsibly. |

Badges update beside the handle as each classification returns. Their tooltip includes the page-session tweet number, model confidence, and category definition. If X unmounts and later remounts the same tweet, its number and cached classification are reused.

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
6. Switch on any categories you want hidden, then open or reload `https://x.com/home`.

Filter choices persist and are broadcast to every open X tab. Matching cards disappear as soon as their classification returns. Pending, unavailable, and failed classifications remain visible because they do not yet have a category. **Show all categories** clears all filters, and **Retry** restarts failed classification batches in open X tabs.

### Recording privacy

Switch on **Anonymize posters** to show only each poster's first name and replace profile photos with a neutral silhouette on X and LinkedIn. The effect is purely presentational: switching it off restores the original page immediately, and Ungrift does not rewrite post data or images at the source. The preference is stored only in the current Chrome profile and is applied to open social tabs without a reload.

## How it works

- A page-world script observes X's existing `fetch` and `XMLHttpRequest` timeline responses by cloning them locally.
- An isolated content script matches that structured data to tweet cards currently mounted in the DOM.
- Each card receives a stable session number, DOM element ID, and an inline category badge.
- Posts are collected into batches of up to eight. Four independent questions per post run together in one Jev request.
- Returned results immediately refresh the badge, category attribute, hide/show decision, and internal classification status together.
- No auto-scroll, X API client, background polling of X, profile lookup, analytics, or tweet-data display is included.

The classifier uses tweet text, handle, profile description, and quoted or reposted text as context. Tweet and quote text are capped at 6,000 characters each and bios at 1,600. These are AI assessments of the available contribution, not verified facts about an author.

The API key is stored in `chrome.storage.local` with access restricted to trusted extension pages. It is never sent to X or exposed to content scripts. Classification results are cached in memory for up to 2,000 contexts; changing the tweet text, bio, or quote causes reclassification.

## Development

```bash
npm install
npm run check
npm run build
```

The credential-free distributable is written to `dist/extension` from an explicit runtime allowlist.

```text
manifest.json              Chrome Manifest V3 entry point
icons/                     Toolbar and extension icons
popup/                     Floating settings popover
src/main-world.js          Observes X's existing timeline responses
src/content.js             Labels and filters rendered tweet cards
src/privacy.js             Visually anonymizes X and LinkedIn post authors
src/tweet-data.js          Normalizes X response objects
src/background.js          Stores settings and brokers Jev requests
src/classification.js      Rubrics, display labels, batching, and cache
src/jev-client.js          Batched Jev API client
tests/                     Extraction, classification, and packaging tests
```

X can change its page markup or response shape without notice. Tweet extraction stays inside the browser; only the collected classification context is sent to TypeSafe. This project is not affiliated with X.
