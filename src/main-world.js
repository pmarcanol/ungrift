(function captureTimelineResponses() {
  "use strict";

  const api = globalThis.__UNGRIFT_TWEET_DATA__;
  const MESSAGE_TYPE = "UNGRIFT_TIMELINE_DATA_V1";
  const TIMELINE_URL = /\/i\/api\/graphql\/[^/]+\/(?:[^/?]*(?:Timeline|TweetDetail)[^/?]*)/i;

  if (!api || globalThis.__UNGRIFT_CAPTURE_INSTALLED__) return;
  Object.defineProperty(globalThis, "__UNGRIFT_CAPTURE_INSTALLED__", { value: true });

  function isUsefulUrl(value) {
    try {
      return TIMELINE_URL.test(new URL(String(value), location.href).pathname);
    } catch {
      return false;
    }
  }

  function publishPayload(payload) {
    const tweets = api.collectTweets(payload);
    if (tweets.length === 0) return;

    window.postMessage({ type: MESSAGE_TYPE, tweets }, location.origin);
  }

  async function inspectResponse(response) {
    try {
      if (!response?.ok) return;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) return;
      publishPayload(await response.json());
    } catch {
      // A response may be streamed, aborted, or non-JSON despite its headers.
    }
  }

  const nativeFetch = window.fetch;
  window.fetch = async function timelineAwareFetch(...args) {
    const response = await nativeFetch.apply(this, args);
    const requestedUrl = args[0] instanceof Request ? args[0].url : args[0];

    if (isUsefulUrl(requestedUrl || response.url)) {
      void inspectResponse(response.clone());
    }

    return response;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function timelineAwareOpen(method, url, ...args) {
    this.__ungriftTimelineUrl = url;
    return nativeOpen.call(this, method, url, ...args);
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function timelineAwareSend(...args) {
    if (isUsefulUrl(this.__ungriftTimelineUrl)) {
      this.addEventListener(
        "load",
        () => {
          try {
            const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
            publishPayload(payload);
          } catch {
            // Ignore non-JSON, inaccessible, and incomplete XHR bodies.
          }
        },
        { once: true }
      );
    }

    return nativeSend.apply(this, args);
  };
})();
