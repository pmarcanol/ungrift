(function () {
  "use strict";
  const platform = /(^|\.)linkedin\.com$/i.test(location.hostname) ? "linkedin" : "x";
  const posts = new WeakMap();
  let enabled = false, labels = {}, selected = null, panel, root, busy = false;
  function id(post) { return post.key.startsWith(`${platform}:`) ? post.key : `${platform}:${post.key}`; }
  function install() {
    if (panel) return;
    const style = document.createElement("style");
    style.textContent = `html.ungrift-marking .ungrift-category-hidden {display: block !important}
      html.ungrift-marking [data-ungrift-post-number] {cursor: crosshair !important}
      html.ungrift-marking [data-ungrift-post-number]:hover {outline: 1px dashed #a7c966;outline-offset:-2px}
      html.ungrift-marking [data-ungrift-marked] {box-shadow: inset 4px 0 #c7f36b !important}
      html.ungrift-marking [data-ungrift-selected] {outline: 2px solid #c7f36b !important;outline-offset:-3px}`;
    document.documentElement.append(style);
    panel = document.createElement("div");
    panel.id = "ungrift-marker";
    root = panel.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host {all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:calc(100vw - 32px);width:344px;color:#f2f3ed;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
      :host([hidden]){display:none} *{box-sizing:border-box} [hidden]{display:none!important}
      section {max-height:calc(100vh - 40px);overflow:auto;padding:18px;background:#151912;border:1px solid #485539;border-radius:14px;box-shadow:0 12px 48px #0007}
      header{display:flex;justify-content:space-between;align-items:center;gap:8px}
      strong{font-size:14px} small{color:#c7f36b;font-size:10px;text-transform:uppercase;letter-spacing:1.2px}
      button,textarea{font:inherit} button{cursor:pointer;border:1px solid #3b4434;border-radius:7px;background:#252c20;color:#f2f3ed;padding:8px 10px}
      button:hover{border-color:#c7f36b} button:focus-visible,textarea:focus-visible{outline:2px solid #c7f36b;outline-offset:2px}
      button:disabled{opacity:.45;cursor:default} #stop,#remove{padding:3px 6px;background:transparent;font-size:11px;color:#aeb7a6}
      p{margin:10px 0;color:#b6bdaf;font-size:12px} #excerpt{max-height:72px;overflow:auto;white-space:pre-wrap;color:#f2f3ed}
      textarea{resize:vertical;width:100%;min-height:52px;max-height:150px;background:#10140d;color:#f2f3ed;border:1px solid #3b4434;border-radius:7px;padding:8px;margin:6px 0 10px}
      label{font-size:11px;color:#aeb7a6} .choices{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
      .choices button[aria-pressed=true]{background:#c7f36b;color:#18200d;border-color:#c7f36b}
      footer{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px} #status{font-size:11px;color:#c7f36b}
    </style><section aria-label="Ungrift post marker">
      <header><div><small>Personal dataset</small><br><strong>Mark posts</strong></div><button id="stop" type="button">Done</button></header>
      <p id="hint">Click a post to label it. Feed links and actions are paused while marking. Hidden posts are shown.</p>
      <div id="editor" hidden><p id="excerpt"></p><label for="note">Why? <span>(optional)</span></label>
        <textarea id="note" maxlength="4000" placeholder="What makes this fluff, a pitch, or useful?"></textarea>
        <div class="choices"><button data-label="slop" title="Fluff or low-substance content" type="button">Slop</button><button data-label="grift" title="Manipulation or self-serving promotion" type="button">Grift</button><button data-label="value" title="Useful, substantive content" type="button">Value</button></div>
        <footer><span id="status" role="status">Choose your label</span><button id="remove" type="button" hidden>Remove label</button></footer>
      </div></section>`;
    document.documentElement.append(panel);
    root.querySelector("#stop").addEventListener("click", async () => {
      try {
        const result = await chrome.runtime.sendMessage({ type: "marking-stop" });
        if (result?.ok) applyMode(false);
        else throw new Error();
      } catch { root.querySelector("#hint").textContent = "Could not exit marking mode. Reload this page to reconnect."; }
    });
    for (const button of root.querySelectorAll("[data-label]")) button.addEventListener("click", () => void save(button.dataset.label));
    root.querySelector("#remove").addEventListener("click", () => void save(null));
    root.querySelector("#note").addEventListener("input", () => { root.querySelector("#status").textContent = "Click a label to save your note"; });
  }
  function applyMode(value) {
    enabled = value === true;
    if (enabled) install();
    if (panel) panel.hidden = !enabled;
    document.documentElement.classList.toggle("ungrift-marking", enabled);
    if (!enabled) { selected?.card.removeAttribute("data-ungrift-selected"); selected = null; }
    else if (root) root.querySelector("#editor").hidden = !selected;
  }
  function renderLabels() {
    for (const card of document.querySelectorAll("[data-ungrift-post-number]")) {
      const post = posts.get(card);
      if (!post) continue;
      const label = labels[id(post)]?.label;
      if (label) card.setAttribute("data-ungrift-marked", label);
      else card.removeAttribute("data-ungrift-marked");
    }
  }
  function renderSelection() {
    if (!selected) return;
    const saved = labels[id(selected.post)];
    for (const button of root.querySelectorAll("[data-label]")) button.setAttribute("aria-pressed", String(button.dataset.label === saved?.label));
    root.querySelector("#remove").hidden = !saved;
  }
  async function save(label) {
    if (!selected || busy) return;
    const target = selected;
    const note = root.querySelector("#note").value;
    busy = true;
    root.querySelector("#status").textContent = "Saving…";
    for (const button of root.querySelectorAll("[data-label], #remove")) button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: label ? "marking-save" : "marking-delete",
        key: target.post.key, post: target.post.context, classification: target.post.classification,
        label, note });
      if (!response?.ok) throw new Error(response?.error || "Could not save. Reload this page and retry.");
      if (label) labels[id(target.post)] = { label, note };
      else delete labels[id(target.post)];
      renderLabels(); renderSelection();
      root.querySelector("#status").textContent = label ? `Saved locally · ${label}` : "Label removed";
    } catch (error) { root.querySelector("#status").textContent = error.message; }
    finally { busy = false; for (const button of root.querySelectorAll("[data-label], #remove")) button.disabled = false; }
  }
  document.addEventListener("click", (event) => {
    if (!enabled || event.composedPath().includes(panel)) return;
    const card = event.composedPath().find((element) => posts.has(element));
    if (!card) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (busy) return;
    selected?.card.removeAttribute("data-ungrift-selected");
    // Freeze the evidence at selection so virtualized/reused cards cannot change the saved post.
    selected = { card, post: structuredClone(posts.get(card)) };
    card.setAttribute("data-ungrift-selected", "true");
    const saved = labels[id(selected.post)];
    root.querySelector("#editor").hidden = false;
    root.querySelector("#excerpt").textContent = selected.post.context.content || "Media post — no text available";
    root.querySelector("#note").value = saved?.note || "";
    root.querySelector("#status").textContent = saved ? `Saved locally · ${saved.label}` : "Choose your label";
    renderSelection();
    root.querySelector("[data-label]").focus({ preventScroll: true });
  }, true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "marking-mode") applyMode(message.enabled);
    if (message?.type === "marking-labels") { labels = message.labels || {}; renderLabels(); renderSelection(); }
  });
  void chrome.runtime.sendMessage({ type: "marking-state" }).then((state) => {
    labels = state?.labels || {}; renderLabels(); applyMode(state?.enabled);
  }).catch(() => {});
  globalThis.UngriftMarker = {
    register(card, key, context, classification) {
      posts.set(card, { key: String(key), context, classification });
      const label = labels[id({ key: String(key) })]?.label;
      if (label) card.setAttribute("data-ungrift-marked", label);
      else card.removeAttribute("data-ungrift-marked");
      if (selected?.card === card && selected.post.key !== String(key)) card.removeAttribute("data-ungrift-selected");
    }
  };
})();
