import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { stats } from "./stats.js";

const ORBIT_SPEED = 0.4;
const ORBIT_PHASE = (2 * Math.PI) / 3;
const CHAR_OFFSET = -120;
const STAGGER = 0.06;
const COLOR_STAGGER = 0.03; // stagger between C, M, Y layers within each character

export function initCmyPages(lenis) {
  let MIN_RADIUS = 1,
    MAX_RADIUS = 6;
  let currentRadius = MIN_RADIUS,
    targetRadius = MIN_RADIUS;

  lenis.on("scroll", () => {
    targetRadius =
      MIN_RADIUS +
      Math.min(Math.abs(lenis.velocity) / 12, 1) * (MAX_RADIUS - MIN_RADIUS);
  });

  // Build number stacks
  function buildStack(stack, text) {
    const spacer = document.createElement("span");
    spacer.className = "num-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.textContent = text;
    stack.appendChild(spacer);

    ["c", "m", "y"].forEach((cls) => {
      const layer = document.createElement("span");
      layer.className = `num-layer ${cls}`;
      text.split("").forEach((ch) => {
        const span = document.createElement("span");
        span.className = "char";
        span.textContent = ch;
        layer.appendChild(span);
      });
      stack.appendChild(layer);
    });
  }

  const labels = ["01", "02", "03", "04", "05"];
  document
    .querySelectorAll(".num-stack")
    .forEach((stack, i) => buildStack(stack, labels[i]));

  // Orbit via ticker
  const numLayers = Array.from(document.querySelectorAll(".num-layer"));
  numLayers.forEach((layer, i) => {
    layer._phase = (i % 3) * ORBIT_PHASE;
  });

  gsap.ticker.add((time) => {
    targetRadius += (MIN_RADIUS - targetRadius) * 0.05;
    currentRadius += (targetRadius - currentRadius) * 0.08;
    numLayers.forEach((layer) => {
      const angle = time * ORBIT_SPEED + layer._phase;
      gsap.set(layer, {
        x: Math.cos(angle) * currentRadius,
        y: Math.sin(angle) * currentRadius,
      });
    });
  });

  // Per-character animations
  function getCharsByIndex(page) {
    const layerEls = page.querySelectorAll(".num-layer");
    const count = layerEls[0].querySelectorAll(".char").length;
    return Array.from({ length: count }, (_, i) =>
      Array.from(layerEls).map((l) => l.querySelectorAll(".char")[i]),
    );
  }

  function animateIn(groups) {
    groups.forEach((group, i) => {
      group.filter(Boolean).forEach((target, j) => {
        gsap.killTweensOf(target);
        gsap.to(target, {
          x: 0,
          autoAlpha: 1,
          duration: 0.5,
          ease: "power3.out",
          delay: i * STAGGER + j * COLOR_STAGGER,
        });
      });
    });
  }

  function animateOut(groups) {
    groups.forEach((group, i) => {
      group.filter(Boolean).forEach((target, j) => {
        gsap.killTweensOf(target);
        gsap.to(target, {
          x: CHAR_OFFSET,
          autoAlpha: 0,
          duration: 0.4,
          ease: "power3.in",
          delay: i * STAGGER + j * COLOR_STAGGER,
        });
      });
    });
  }

  document.querySelectorAll(".page:not(#title-page)").forEach((page) => {
    const groups = getCharsByIndex(page);
    gsap.set(groups.flat(), { x: CHAR_OFFSET, autoAlpha: 0 });

    ScrollTrigger.create({
      trigger: page,
      start: "top 60%",
      end: "top -10%",
      onEnter: () => animateIn(groups),
      onLeave: () => animateOut(groups),
      onEnterBack: () => animateIn(groups),
      onLeaveBack: () => animateOut(groups),
    });
  });

  gsap.delayedCall(0.3, () => {
    const firstGroups = getCharsByIndex(
      document.querySelector(".page:not(#title-page)"),
    );
    animateIn(firstGroups);
  });

  // Heading per-character animations (mirrored from right)
  const HEADING_OFFSET = 120; // positive = from right
  const HEADING_STAGGER = 0.06;
  const HEADING_COLOR_STAGGER = 0.03;

  function buildHeadingStack(mask) {
    const heading = mask.querySelector(".page-heading");
    const text = heading.textContent;
    heading.remove();

    const spacer = document.createElement("span");
    spacer.className = "heading-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.textContent = text;
    mask.appendChild(spacer);

    ["c", "m", "y"].forEach((cls) => {
      const layer = document.createElement("span");
      layer.className = `heading-layer ${cls}`;
      text.split("").forEach((ch) => {
        const span = document.createElement("span");
        span.className = "hchar";
        span.textContent = ch === " " ? "\u00A0" : ch;
        layer.appendChild(span);
      });
      mask.appendChild(layer);
    });
  }

  const cmyPages = document.querySelectorAll(".page:not(#title-page)");
  cmyPages.forEach((page) => {
    const mask = page.querySelector(".heading-mask");
    if (mask) buildHeadingStack(mask);
  });

  function getHeadingCharsByIndex(page) {
    const layers = page.querySelectorAll(".heading-layer");
    if (!layers.length) return [];
    const count = layers[0].querySelectorAll(".hchar").length;
    return Array.from({ length: count }, (_, i) =>
      Array.from(layers).map((l) => l.querySelectorAll(".hchar")[i]),
    );
  }

  function headingIn(groups) {
    groups.forEach((group, i) => {
      group.filter(Boolean).forEach((target, j) => {
        gsap.killTweensOf(target);
        gsap.to(target, {
          x: 0,
          autoAlpha: 1,
          duration: 0.5,
          ease: "power3.out",
          delay: i * HEADING_STAGGER + j * HEADING_COLOR_STAGGER,
        });
      });
    });
  }

  function headingOut(groups) {
    const last = groups.length - 1;
    groups.forEach((group, i) => {
      group.filter(Boolean).forEach((target, j) => {
        gsap.killTweensOf(target);
        gsap.to(target, {
          x: HEADING_OFFSET,
          autoAlpha: 0,
          duration: 0.4,
          ease: "power3.in",
          delay: (last - i) * HEADING_STAGGER + j * HEADING_COLOR_STAGGER,
        });
      });
    });
  }

  cmyPages.forEach((page) => {
    const groups = getHeadingCharsByIndex(page);
    if (!groups.length) return;
    gsap.set(groups.flat(), { x: HEADING_OFFSET, autoAlpha: 0 });

    ScrollTrigger.create({
      trigger: page,
      start: "top 10%",
      end: "top -30%",
      onEnter: () => headingIn(groups),
      onLeave: () => headingOut(groups),
      onEnterBack: () => headingIn(groups),
      onLeaveBack: () => headingOut(groups),
    });
  });

  // Split circle animation — scale right then left clip paths
  const rightClip = document.querySelector(".right-clip");
  if (rightClip) {
    // Phase 1: right half scales from 1 to 0
    ScrollTrigger.create({
      trigger: "#page-01",
      start: "top 60%",
      end: "top 30%",
      scrub: true,
      onUpdate: (self) => {
        const sx = 1 - self.progress;
        rightClip.setAttribute(
          "transform",
          `translate(0.5, 0) scale(${sx}, 1) translate(-0.5, 0)`,
        );
      },
    });
  }

  // Phase 2a: concentric-left scales from 0 to 0.5 as page arrives
  const concentricLeft = document.querySelector(".concentric-left");
  const splitCircle = document.querySelector(".split-circle");
  if (concentricLeft) {
    ScrollTrigger.create({
      trigger: "#page-01",
      start: "top 30%",
      end: "top 0%",
      scrub: true,
      onUpdate: (self) => {
        const sx = self.progress * 0.5;
        const brightness = 0.5 + self.progress * 0.3;
        gsap.set(concentricLeft, {
          scaleX: sx,
          filter: `brightness(${brightness})`,
        });
      },
    });

    // Phase 2b: continues from 0.5 to 1 as page scrolls past (same 30% range)
    ScrollTrigger.create({
      trigger: "#page-01",
      start: "top 0%",
      end: "top -30%",
      scrub: true,
      onLeave: () => {
        splitCircle && gsap.set(splitCircle, { autoAlpha: 0 });
        gsap.set(concentricLeft, { autoAlpha: 0 });
      },
      onEnterBack: () => {
        splitCircle && gsap.set(splitCircle, { autoAlpha: 1 });
        gsap.set(concentricLeft, { autoAlpha: 1 });
      },
      onUpdate: (self) => {
        const sx = 0.5 + self.progress * 0.5;
        const brightness = 0.8 + self.progress * 0.2;
        gsap.set(concentricLeft, { scaleX: sx, filter: `brightness(${brightness})` });
      },
    });

    // Phase 4: scatter concentric rings in different upward directions
    const ringOuter = document.querySelector(".ring-outer");
    const ringMiddle = document.querySelector(".ring-middle");
    const ringInner = document.querySelector(".ring-inner");
    if (ringOuter) {
      ScrollTrigger.create({
        trigger: "#page-01",
        start: "top -30%",
        end: "top -70%",
        scrub: true,
        onUpdate: (self) => {
          const p = self.progress;
          gsap.set(ringOuter, { x: -p * 150, y: -p * 200 });
          gsap.set(ringMiddle, { x: p * 80, y: -p * 250 });
          gsap.set(ringInner, { x: p * 200, y: -p * 180 });
        },
      });
    }
  }

  // Click ripple on page-01 — each band pulses independently, staggered inner→outer
  const page01 = document.getElementById("page-01");
  if (page01) {
    const cc = page01.querySelector(".concentric-circles");
    const cl = page01.querySelector(".concentric-left");
    const splitCircle = page01.querySelector(".split-circle");

    // Each band = matching rings across both halves
    const bandSelectors = [".ring-inner", ".ring-middle", ".ring-outer"];
    const bands = bandSelectors.map((sel) => {
      const els = [];
      if (cc) { const e = cc.querySelector(sel); if (e) els.push(e); }
      if (cl) { const e = cl.querySelector(sel); if (e) els.push(e); }
      return els;
    });
    // Split circle pulses with the outer ring
    if (splitCircle) bands[bands.length - 1].push(splitCircle);

    const bandProxies = bands.map((els) => ({ proxy: { v: 1 }, els }));
    const RIPPLE_STAGGER = 0.06;

    page01.addEventListener("mousedown", () => {
      stats.page01.clickCount++;
      bandProxies.forEach(({ proxy, els }, i) => {
        gsap.killTweensOf(proxy);
        proxy.v = 1;
        gsap.to(proxy, {
          v: 1.08,
          duration: 0.15,
          ease: "power2.out",
          delay: i * RIPPLE_STAGGER,
          onUpdate() {
            els.forEach((el) => (el.style.scale = proxy.v));
          },
          onComplete() {
            gsap.to(proxy, {
              v: 1,
              duration: 0.5,
              ease: "elastic.out(1, 0.4)",
              onUpdate() {
                els.forEach((el) => (el.style.scale = proxy.v));
              },
            });
          },
        });
      });
    });
  }

  // Parallax
  document.querySelectorAll(".page:not(#title-page)").forEach((page) => {
    gsap.fromTo(
      page.querySelector(".num-stack"),
      { y: "4%" },
      {
        y: "-4%",
        ease: "none",
        scrollTrigger: {
          trigger: page,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      },
    );
  });
}
