"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build, FILES } = require("../scripts/build.js");
const { CATEGORIES } = require("../src/classification.js");

test("distributable contains only allowlisted runtime files and no credentials", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ungrift-build-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  build(folder);
  const files = fs.readdirSync(folder, { recursive: true }).filter((file) => fs.statSync(path.join(folder, file)).isFile());
  assert.deepEqual(files.sort(), [...FILES].sort());
  assert.ok(!files.some((file) => /\.env|\.context|node_modules|tests/.test(file)));
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(folder, file), "utf8"), /apikey_[A-Za-z0-9_-]{30,}/, file);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
  assert.equal(manifest.name, "Ungrift");
  assert.equal(manifest.version, require("../package.json").version);
  assert.ok(manifest.host_permissions.includes("https://api.typesafe.ai/*"));
  assert.ok(manifest.host_permissions.includes("https://www.linkedin.com/*"));
  assert.ok(!manifest.host_permissions.some((host) => host.includes("127.0.0.1")));
  assert.equal(manifest.action.default_popup, "popup/index.html");
  assert.equal(manifest.side_panel, undefined);
  const feedScript = manifest.content_scripts.find((script) => script.js.includes("src/content.js"));
  assert.ok(feedScript.matches.includes("https://www.linkedin.com/*"));
  assert.ok(feedScript.js.includes("src/linkedin-data.js"));
  assert.ok(feedScript.js.includes("src/privacy.js"));
  assert.ok(files.includes("icons/icon16.png"));
  assert.ok(files.includes("icons/icon128.png"));
  assert.ok(files.includes("src/linkedin-data.js"));
  assert.ok(files.includes("src/privacy.js"));
  assert.ok(!files.some((file) => file.startsWith("sidepanel/") || file.startsWith("options/")));
  const popup = fs.readFileSync(path.join(folder, "popup/index.html"), "utf8");
  assert.match(popup, /id="anonymize-posters"/);
  const filterValues = [...popup.matchAll(/<input type="checkbox" value="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(filterValues, Object.keys(CATEGORIES));
  const retiredNames = [["X", "RAY"].join("/"), ["x", "timeline", "json"].join("-"), ["X", "Timeline"].join("")];
  for (const file of files.filter((name) => /\.(?:css|html|js|json)$/.test(name))) {
    const contents = fs.readFileSync(path.join(folder, file), "utf8");
    for (const retiredName of retiredNames) assert.ok(!contents.includes(retiredName), file);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(folder, "src/background.js"), "utf8"), /getURL\(["']\.env/);
});
