"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Explicit runtime allowlist: never copy .env, skills, test profiles, or local files.
const FILES = [
  "manifest.json", "src/main-world.js", "src/tweet-data.js", "src/content.js",
  "src/background.js", "src/classification.js", "src/jev-client.js",
  "popup/index.html", "popup/popup.css", "popup/popup.js",
  "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"
];

function build(destination = path.resolve(__dirname, "../dist/extension")) {
  fs.rmSync(destination, { recursive: true, force: true });
  for (const file of FILES) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, "..", file), target);
  }
  return destination;
}

if (require.main === module) console.log(`Credential-free extension built at ${build()}`);
module.exports = { build, FILES };
