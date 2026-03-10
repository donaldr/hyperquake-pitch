import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "@fontsource/jersey-15";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/800.css";
import "./style.css";

const DEBUG_KEEP_SCROLL = false; // set to false for production (resets to top on reload)
const DEBUG_SKIP_PASSWORD = false; // set to true to bypass password screen
if (!DEBUG_KEEP_SCROLL) {
  history.scrollRestoration = "manual";
  window.scrollTo(0, 0);
} else {
  history.scrollRestoration = "auto";
}

import { buildTitle } from "./voronoi-title.js";
import { initCmyPages } from "./cmy-pages.js";
import { initTitledParagraphs } from "./titled-paragraph.js";
import { initIconMorph } from "./icon-morph.js";
import { initEyeFollow } from "./eye-follow.js";
import { initHighlightParagraphs } from "./highlight-paragraph.js";
import { initCmyCursor } from "./cmy-cursor.js";
import { initShapeBuilder } from "./shape-builder.js";
import { initPageTracking } from "./stats.js";
import { initAIPage } from "./ai-page.js";
import { initFinPage } from "./fin-page.js";
gsap.registerPlugin(ScrollTrigger);

// ── Enter gate ──────────────────────────────────────────────────────────────
if (!DEBUG_SKIP_PASSWORD) document.documentElement.classList.add("no-scroll");

// ── Lenis ────────────────────────────────────────────────────────────────────
const lenis = new Lenis({ lerp: 0.08, smoothWheel: true });
if (!DEBUG_SKIP_PASSWORD) lenis.stop();
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

lenis.on("scroll", () => {
  ScrollTrigger.update();
});

// ── Title page ───────────────────────────────────────────────────────────────
let startTitle = null;
const titleReady = buildTitle(lenis)
  .then(({ start }) => {
    startTitle = start;
  })
  .catch((err) => {
    document.getElementById("loading").textContent = "Error: " + err.message;
    console.error("buildTitle error:", err);
  });

// ── Preserve relative scroll position on resize ─────────────────────────────
let scrollRatio = 0;
window.addEventListener("scroll", () => {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll > 0) scrollRatio = window.scrollY / maxScroll;
});
window.addEventListener("resize", () => {
  requestAnimationFrame(() => {
    const newMax = document.documentElement.scrollHeight - window.innerHeight;
    const newY = scrollRatio * newMax;
    window.scrollTo(0, newY);
    lenis.scrollTo(newY, { immediate: true });
  });
});

// ── CMY pages ────────────────────────────────────────────────────────────────
initCmyPages(lenis);
initTitledParagraphs();
initIconMorph();
initEyeFollow();
initHighlightParagraphs();
initCmyCursor();
initShapeBuilder();
initPageTracking();
initAIPage();

initFinPage();

// ── Enter gate handler ──────────────────────────────────────────────────────
{
  const PASSWORD = "hyperquake";
  const overlay = document.getElementById("enter-overlay");
  const form = document.getElementById("enter-form");
  const input = document.getElementById("enter-password");

  function unlock() {
    document.documentElement.classList.remove("no-scroll");
    lenis.start();
    overlay.classList.add("fade-out");
    let started = false;
    overlay.addEventListener("transitionend", function handler(e) {
      if (e.target !== overlay || e.propertyName !== "opacity") return;
      overlay.removeEventListener("transitionend", handler);
      overlay.remove();
      if (startTitle && !started) {
        started = true;
        startTitle();
      }
    });
  }

  if (DEBUG_SKIP_PASSWORD) {
    overlay.remove();
    document.documentElement.classList.remove("no-scroll");
    titleReady.then(() => {
      if (startTitle) startTitle();
    });
  } else {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value.toLowerCase().trim() === PASSWORD) {
        unlock();
      } else {
        // Shake on wrong password
        form.classList.remove("shake");
        void form.offsetWidth; // reflow to restart animation
        form.classList.add("shake");
        input.value = "";
      }
    });
  }
}

// ── Auto-hide cursor ────────────────────────────────────────────────────────
{
  let cursorTimer = null;
  let overInteractive = false;
  document.documentElement.classList.add("hide-cursor");

  document.querySelectorAll(".mouseover").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      overInteractive = true;
      clearTimeout(cursorTimer);
      document.documentElement.classList.remove("hide-cursor");
    });
    el.addEventListener("mouseleave", () => {
      overInteractive = false;
    });
  });

  document.addEventListener("mousemove", () => {
    document.documentElement.classList.remove("hide-cursor");
    clearTimeout(cursorTimer);
    if (!overInteractive) {
      cursorTimer = setTimeout(() => {
        document.documentElement.classList.add("hide-cursor");
        window.dispatchEvent(new Event("cursor-hidden"));
      }, 2000);
    }
  });
}
