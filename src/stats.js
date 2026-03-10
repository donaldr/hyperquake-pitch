// ── Centralized stats tracking ───────────────────────────────────────────────
// Each page module calls these helpers to record interactions.
// The AI page (page-05) reads `stats` to display them.

export const stats = {
  title: {
    jitterCount: 0,
    mouseMovedUnclicked: 0, // seconds
    clickCount: 0,
    mouseClickedDuration: 0, // seconds
    mouseMovedClicked: 0, // seconds
    timeOnPage: 0, // seconds
  },
  page01: {
    clickCount: 0,
    timeOnPage: 0,
  },
  page02: {
    paraHovers: [0, 0, 0, 0, 0], // per-paragraph hover count
    paraReveals: [0, 0, 0, 0, 0], // per-paragraph reveal count (auto + hover)
    clickCount: 0,
    mouseHeldDuration: 0, // seconds
    timeOnPage: 0,
  },
  page03: {
    mouseMovingDuration: 0, // seconds
    blinkClicks: 0,
    eyeCloses: 0,
    eyeSleeps: 0,
    timeOnPage: 0,
  },
  page04: {
    smallPyramidsBuilt: 0,
    mouseMovingDuration: 0, // seconds
    mousePressedDuration: 0, // seconds
    clickCount: 0,
    largePyramidsBuilt: 0,
    timeOnPage: 0,
  },
  page05: {
    timeOnPage: 0,
    wasdPresses: 0,
  },
};

// ── Current page tracking ───────────────────────────────────────────────────
// Determined by which page covers the most viewport area.
let currentPage = null;

export function getCurrentPage() {
  return currentPage;
}

// Map page elements to stat keys (populated by initPageTracking)
const pageMap = new Map();

// Given a DOM event, return the stat key if the event target is within a tracked page
export function pageKeyForEvent(e) {
  let node = e.target;
  while (node && node !== document.body) {
    if (pageMap.has(node)) return pageMap.get(node);
    node = node.parentElement;
  }
  return null;
}

export function initPageTracking() {
  const pages = [
    { el: "#title-page", key: "title" },
    { el: "#page-01", key: "page01" },
    { el: "#page-02", key: "page02" },
    { el: "#page-03", key: "page03" },
    { el: "#page-04", key: "page04" },
    { el: "#page-05", key: "page05" },
  ];

  const pageEls = [];
  pages.forEach(({ el, key }) => {
    const element = document.querySelector(el);
    if (!element) return;
    pageMap.set(element, key);
    pageEls.push({ element, key });
  });

  // Determine dominant visible page by intersection ratio
  function updateCurrentPage() {
    let best = null;
    let bestRatio = 0;
    const vh = window.innerHeight;
    for (const { element, key } of pageEls) {
      const rect = element.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(vh, rect.bottom);
      const visible = Math.max(0, bottom - top);
      if (visible > bestRatio) {
        bestRatio = visible;
        best = key;
      }
    }
    currentPage = best;
  }

  // Track time on the dominant page
  let lastTick = performance.now();
  let tabVisible = !document.hidden;

  document.addEventListener("visibilitychange", () => {
    tabVisible = !document.hidden;
    lastTick = performance.now(); // reset so returning doesn't spike dt
  });

  function tick() {
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    updateCurrentPage();
    if (currentPage && stats[currentPage] && tabVisible) {
      stats[currentPage].timeOnPage += dt;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
