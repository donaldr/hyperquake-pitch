import lottie from "lottie-web";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { stats } from "./stats.js";

const ICON_PATHS = [
  "/lottie/cube1.json",
  "/lottie/cube2.json",
  "/lottie/cube3.json",
  "/lottie/cube4.json",
  "/lottie/cube5.json",
];

// Per-icon scale overrides (index → scale). Icons not listed default to 1.
const ICON_SCALES = { 2: 1.4 };

const MORPH_TIME = 0.8; // seconds for cross-fade
const COOLDOWN_TIME = 2.5; // seconds to hold before cycling
// Cycle order for clockwise selection: top → right-upper → right-lower → left-lower → left-upper
const CYCLE_ORDER = [0, 1, 2, 4, 3];
const BLUR_MAX = 100;

export function initIconMorph() {
  const page = document.getElementById("page-02");
  if (!page) return;

  const container = page.querySelector(".morph-icon-container");

  // Create a persistent div for each icon and preload all animations
  const iconEls = [];
  const playerRefs = [];
  let loadCount = 0;

  ICON_PATHS.forEach((path, i) => {
    const el = document.createElement("div");
    el.className = "morph-icon";
    el.style.opacity = i === 0 ? "100%" : "0%";
    if (ICON_SCALES[i]) el.style.transform = `scale(${ICON_SCALES[i]})`;
    container.appendChild(el);
    iconEls.push(el);

    const player = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path,
    });
    playerRefs.push(player);
    player.addEventListener("DOMLoaded", () => {
      loadCount++;
      if (loadCount === ICON_PATHS.length) onAllLoaded();
    });
  });

  // Remove the placeholder containers from HTML
  const iconA = document.getElementById("morph-icon-a");
  const iconB = document.getElementById("morph-icon-b");
  if (iconA) iconA.remove();
  if (iconB) iconB.remove();

  function onAllLoaded() {
    currentIndex = 0;
    startCycle();
    setupScrollTrigger();
  }

  let currentIndex = 0;
  let morphing = false;
  let morphRaf = null;
  let cycleTimer = null;
  let hoveredIndex = -1;
  let active = false;

  // Morph from current icon to target index
  function morphTo(targetIndex) {
    if (morphing) return;
    if (targetIndex === currentIndex) return;
    morphing = true;

    const fromEl = iconEls[currentIndex];
    const toEl = iconEls[targetIndex];

    const startTime = performance.now();

    function tick() {
      const elapsed = (performance.now() - startTime) / 1000;
      let fraction = Math.min(elapsed / MORPH_TIME, 1);

      const blurOut = Math.min(8 / Math.max(1 - fraction, 0.001) - 8, BLUR_MAX);
      const blurIn = Math.min(8 / Math.max(fraction, 0.001) - 8, BLUR_MAX);

      fromEl.style.filter = `blur(${blurOut}px)`;
      fromEl.style.opacity = `${Math.pow(1 - fraction, 0.4) * 100}%`;
      toEl.style.filter = `blur(${blurIn}px)`;
      toEl.style.opacity = `${Math.pow(fraction, 0.4) * 100}%`;

      if (fraction < 1) {
        morphRaf = requestAnimationFrame(tick);
      } else {
        // Clean up: hide old, show new cleanly
        fromEl.style.filter = "";
        fromEl.style.opacity = "0%";
        toEl.style.filter = blobHeld ? `blur(${blobBlur}px)` : "";
        toEl.style.opacity = "100%";

        currentIndex = targetIndex;
        morphing = false;

        if (blobHeld) {
          applyBlob(BLOB_BLUR, 0.3);
        } else if (hoveredIndex === -1 && active) {
          scheduleCycle();
        }
      }
    }

    morphRaf = requestAnimationFrame(tick);
  }

  function scheduleCycle() {
    clearTimeout(cycleTimer);
    cycleTimer = setTimeout(() => {
      if (!active) return;
      const cyclePos = CYCLE_ORDER.indexOf(currentIndex);
      const next = CYCLE_ORDER[(cyclePos + 1) % CYCLE_ORDER.length];
      stats.page02.paraReveals[next]++;
      updateCalloutHighlight(next);
      morphTo(next);
    }, COOLDOWN_TIME * 1000);
  }

  function startCycle() {
    if (!active) return;
    scheduleCycle();
  }

  function stopCycle() {
    clearTimeout(cycleTimer);
  }

  const radialParas = page.querySelectorAll(".radial-para");

  function positionRadialParas() {
    const pageRect = page.getBoundingClientRect();
    const iconWrap = page.querySelector(".morph-icon-wrap");
    const iconRect = iconWrap.getBoundingClientRect();
    const headingMask = page.querySelector(".heading-mask");
    const headingRect = headingMask.getBoundingClientRect();
    const numStack = page.querySelector(".num-stack");
    const numRect = numStack.getBoundingClientRect();

    // Page-relative percentages
    const iconCx = ((iconRect.left + iconRect.width / 2 - pageRect.left) / pageRect.width) * 100;
    const iconCy = ((iconRect.top + iconRect.height / 2 - pageRect.top) / pageRect.height) * 100;

    // Right column (paras 2 & 3): 60% of the way from icon to right edge
    const rightX = iconCx + (100 - iconCx) * 0.6;
    // Vertical range: top of page → top of heading
    const headingTopPct = ((headingRect.top - pageRect.top) / pageRect.height) * 100;
    const rightY1 = headingTopPct / 3;
    const rightY2 = (headingTopPct * 2) / 3;

    // Left column (paras 4 & 5): 60% of the way from icon to left edge
    const leftX = iconCx * 0.4;
    // Vertical range: bottom of num-stack → bottom of page
    const numBottomPct = ((numRect.bottom - pageRect.top) / pageRect.height) * 100;
    const leftRange = 100 - numBottomPct;
    const leftY1 = numBottomPct + leftRange / 3;
    const leftY2 = numBottomPct + (leftRange * 2) / 3;

    // Para 1: 60% of the way from icon to top, horizontally between num-stack right and right column
    const topY = iconCy * 0.4;
    const numRightPct = ((numRect.right - pageRect.left) / pageRect.width) * 100;
    const topX = (numRightPct + rightX) / 2;

    const positions = [
      [topX, topY],      // Para 1: top center
      [rightX, rightY1], // Para 2: right upper
      [rightX, rightY2], // Para 3: right lower
      [leftX, leftY1],   // Para 4: left upper
      [leftX, leftY2],   // Para 5: left lower
    ];

    radialParas.forEach((rp, i) => {
      rp.style.left = `${positions[i][0]}%`;
      rp.style.top = `${positions[i][1]}%`;
    });
  }

  positionRadialParas();
  window.addEventListener("resize", positionRadialParas);
  radialParas.forEach((rp) => {
    const idx = parseInt(rp.dataset.index, 10);

    rp.addEventListener("mouseenter", () => {
      hoveredIndex = idx;
      stats.page02.paraHovers[idx]++;
      stats.page02.paraReveals[idx]++;
      stopCycle();
      morphTo(idx);
      // Highlight callout
      updateCalloutHighlight(idx);
    });

    rp.addEventListener("mouseleave", () => {
      hoveredIndex = -1;
      updateCalloutHighlight(-1);
      if (active) scheduleCycle();
    });
  });

  // When cursor hides, treat it as mouse leaving
  window.addEventListener("cursor-hidden", () => {
    if (hoveredIndex !== -1) {
      hoveredIndex = -1;
      updateCalloutHighlight(-1);
      if (active) scheduleCycle();
    }
  });

  // Callout lines
  const calloutSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  calloutSvg.classList.add("callout-svg");
  page.appendChild(calloutSvg);

  const calloutData = [];

  function buildCallouts() {
    calloutSvg.innerHTML = "";
    calloutData.length = 0;

    const pageRect = page.getBoundingClientRect();
    const iconWrap = page.querySelector(".morph-icon-wrap");
    const iconRect = iconWrap.getBoundingClientRect();
    const icx = iconRect.left + iconRect.width / 2 - pageRect.left;
    const icy = iconRect.top + iconRect.height / 2 - pageRect.top;

    radialParas.forEach((rp, i) => {
      const para = rp.querySelector(".titled-para");
      const titleEl = para.querySelector(".tp-title");
      const titleRect = titleEl.getBoundingClientRect();

      // Find the edge of the paragraph closest to icon center
      const paraRect = rp.getBoundingClientRect();
      const pl = paraRect.left - pageRect.left;
      const pt = paraRect.top - pageRect.top;
      const pr = pl + paraRect.width;
      const pb = pt + paraRect.height;
      const pcx = (pl + pr) / 2;
      const pcy = (pt + pb) / 2;

      // Direction from paragraph center to icon center
      const dx = icx - pcx;
      const dy = icy - pcy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;

      // Ray-box intersection to find edge point
      let sx, sy;
      const hw = paraRect.width / 2;
      const hh = paraRect.height / 2;
      const tx = nx !== 0 ? hw / Math.abs(nx) : Infinity;
      const ty = ny !== 0 ? hh / Math.abs(ny) : Infinity;
      const t = Math.min(tx, ty);
      const gap = (i === 1 || i === 2) ? 20 : 8;
      sx = pcx + nx * (t + gap);
      sy = pcy + ny * (t + gap);

      // End near icon edge
      const iconR = iconRect.width / 2 + 15;
      const ex = icx - nx * iconR;
      const ey = icy - ny * iconR;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", sx);
      line.setAttribute("y1", sy);
      line.setAttribute("x2", ex);
      line.setAttribute("y2", ey);
      line.classList.add("callout-line");
      calloutSvg.appendChild(line);

      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", ex);
      dot.setAttribute("cy", ey);
      dot.setAttribute("r", 3);
      dot.classList.add("callout-dot");
      calloutSvg.appendChild(dot);

      const length = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
      gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
      gsap.set(dot, { autoAlpha: 0 });

      calloutData.push({ line, dot, length, paraEl: rp });
    });
  }

  // Show/hide callout for active index
  let activeCallout = -1;

  function updateCalloutHighlight(idx) {
    // Hide all others
    calloutData.forEach((cd, i) => {
      if (i !== idx) {
        gsap.killTweensOf(cd.line);
        gsap.killTweensOf(cd.dot);
        gsap.to(cd.line, { strokeDashoffset: cd.length, duration: 0.3, ease: "power2.in" });
        gsap.to(cd.dot, { autoAlpha: 0, duration: 0.2 });
      }
    });

    activeCallout = idx;

    // Toggle active class on paragraphs
    radialParas.forEach((rp, i) => {
      rp.classList.toggle("active", i === idx);
    });

    // Show new
    if (idx >= 0 && idx < calloutData.length) {
      const cur = calloutData[idx];
      gsap.killTweensOf(cur.line);
      gsap.killTweensOf(cur.dot);
      gsap.to(cur.line, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" });
      gsap.to(cur.dot, { autoAlpha: 1, duration: 0.3, delay: 0.3 });
    }
  }


  function setupScrollTrigger() {
    // Build callouts after DOM is ready
    buildCallouts();

    // Show first callout
    updateCalloutHighlight(0);

    let hasScrolled = false;
    window.addEventListener("scroll", () => { hasScrolled = true; }, { once: true });

    ScrollTrigger.create({
      trigger: page,
      start: "top 60%",
      end: "top -20%",
      onEnter: () => {
        active = true;
        if (hasScrolled) stats.page02.paraReveals[currentIndex]++;
        startCycle();
      },
      onLeave: () => {
        active = false;
        stopCycle();
      },
      onEnterBack: () => {
        active = true;
        stats.page02.paraReveals[currentIndex]++;
        startCycle();
      },
      onLeaveBack: () => {
        active = false;
        stopCycle();
      },
    });
  }

  // Rebuild callouts on resize
  window.addEventListener("resize", () => {
    buildCallouts();
    if (activeCallout >= 0) {
      updateCalloutHighlight(activeCallout);
    }
  });

  // Mousedown blob — blur the current icon element so the parent threshold creates a blob
  const BLOB_BLUR = 8;
  let blobHeld = false;
  let blobBlur = 0;

  function applyBlob(targetBlur, duration) {
    const proxy = { v: blobBlur };
    gsap.killTweensOf(proxy);
    gsap.to(proxy, {
      v: targetBlur,
      duration,
      ease: "power2.out",
      onUpdate() {
        blobBlur = proxy.v;
        const el = iconEls[currentIndex];
        if (el) el.style.filter = blobBlur > 0.1 ? `blur(${blobBlur}px)` : "";
      },
    });
  }

  let blobDownTime = 0;
  page.addEventListener("mousedown", () => {
    blobHeld = true;
    blobDownTime = performance.now();
    stats.page02.clickCount++;
    stopCycle();
    // If not mid-morph, blob the current icon immediately
    if (!morphing) applyBlob(BLOB_BLUR, 0.3);
    // If mid-morph, the completion handler will apply blob via blobHeld check
  });

  window.addEventListener("mouseup", () => {
    if (!blobHeld) return;
    stats.page02.mouseHeldDuration += (performance.now() - blobDownTime) / 1000;
    blobHeld = false;
    applyBlob(0, 0.5);
    if (active && hoveredIndex === -1) scheduleCycle();
  });
}
