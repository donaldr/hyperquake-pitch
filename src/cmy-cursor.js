import gsap from "gsap";

const CURSOR_SIZE = 24; // diameter of each circle in px
const ORBIT_SPEED = 0.4; // radians per second (matches CMY numbers)
const ORBIT_PHASE = (2 * Math.PI) / 3; // 120° between each circle
const ORBIT_RADIUS = 1; // base orbit radius at rest
const ORBIT_RADIUS_DOWN = 3; // orbit radius when mouse is held
const ORBIT_SPEED_DOWN = 1.0; // base rotation speed when mouse is held
const ORBIT_SWING = 1.5; // swing amplitude in radians when held
const ORBIT_SWING_FREQ = 0.8; // swing frequency in Hz
const FOLLOW_LERP = [0.28, 0.14, 0.1]; // per-dot follow speed (C, M, Y) — staggered so they separate on movement

export function initCmyCursor() {
  // Hide default cursor
  document.documentElement.style.cursor = "none";

  // Each dot is its own fixed-position element
  const dots = ["#00ffff", "#ff00ff", "#ffff00"].map((color) => {
    const dot = document.createElement("div");
    dot.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: ${CURSOR_SIZE}px;
      height: ${CURSOR_SIZE}px;
      border-radius: 50%;
      background: ${color};
      mix-blend-mode: multiply;
      pointer-events: none;
      z-index: 10000;
      will-change: transform;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(dot);
    return dot;
  });

  // Switch to additive (screen) blending while enter overlay is present
  function updateBlendMode() {
    const overlay = document.getElementById("enter-overlay");
    const mode = overlay ? "screen" : "multiply";
    dots.forEach((dot) => (dot.style.mixBlendMode = mode));
  }
  updateBlendMode();

  // Watch for overlay removal
  const observer = new MutationObserver(() => {
    if (!document.getElementById("enter-overlay")) {
      updateBlendMode();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let cursorVisible = false;
  let overPointer = false;
  let overFadeZone = false;
  let hideTimer = null;

  // Fade CMY cursor over elements with .cmy-fade class
  document.querySelectorAll(".cmy-fade").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      overFadeZone = true;
      dots.forEach((dot) => (dot.style.opacity = "0.1"));
    });
    el.addEventListener("mouseleave", () => {
      overFadeZone = false;
      if (cursorVisible) dots.forEach((dot) => (dot.style.opacity = "1"));
    });
  });
  const dotX = dots.map(() => mouseX);
  const dotY = dots.map(() => mouseY);
  const half = CURSOR_SIZE / 2;

  function showCursor() {
    if (overPointer) {
      if (cursorVisible) {
        cursorVisible = false;
        dots.forEach((dot) => (dot.style.opacity = "0"));
      }
      return;
    }
    if (overFadeZone) {
      cursorVisible = true;
      dots.forEach((dot) => (dot.style.opacity = "0.1"));
      clearTimeout(hideTimer);
      if (!isMouseDown) {
        hideTimer = setTimeout(() => {
          cursorVisible = false;
          dots.forEach((dot) => (dot.style.opacity = "0"));
        }, 2000);
      }
      return;
    }
    if (!cursorVisible) {
      cursorVisible = true;
      dots.forEach((dot) => (dot.style.opacity = "1"));
    }
    clearTimeout(hideTimer);
    if (!isMouseDown) {
      hideTimer = setTimeout(() => {
        cursorVisible = false;
        dots.forEach((dot) => (dot.style.opacity = "0"));
      }, 2000);
    }
  }

  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    const el = document.elementFromPoint(mouseX, mouseY);
    const cursor = el ? getComputedStyle(el).cursor : "";
    const tag = el ? el.tagName : "";
    overPointer = cursor.includes("pointer") || cursor.includes("url") || cursor === "text" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    showCursor();
  });

  // Pulse on mousedown / click
  let dotScale = 1;
  const SCALE_DOWN = 1.0;
  const SCALE_HOLD = 1.4;

  let isMouseDown = false;

  window.addEventListener("mousedown", () => {
    isMouseDown = true;
    showCursor();
    gsap.killTweensOf({ _: "dotScale" });
    gsap.to(
      { v: dotScale },
      {
        v: SCALE_HOLD,
        duration: 0.15,
        ease: "power2.out",
        onUpdate() {
          dotScale = this.targets()[0].v;
        },
        _: "dotScale",
      },
    );
  });

  window.addEventListener("mouseup", () => {
    isMouseDown = false;
    showCursor();
    gsap.killTweensOf({ _: "dotScale" });
    gsap.to(
      { v: dotScale },
      {
        v: SCALE_DOWN,
        duration: 0.3,
        ease: "power2.out",
        onUpdate() {
          dotScale = this.targets()[0].v;
        },
        _: "dotScale",
      },
    );
  });

  const orbitAngles = [0, 0, 0];
  let lastTime = null;

  gsap.ticker.add((time) => {
    const dt = lastTime !== null ? time - lastTime : 0;
    lastTime = time;

    const baseSpeed = isMouseDown ? ORBIT_SPEED_DOWN : ORBIT_SPEED;

    dots.forEach((dot, i) => {
      orbitAngles[i] += baseSpeed * dt;

      // Each dot trails the mouse at its own speed
      dotX[i] += (mouseX - dotX[i]) * FOLLOW_LERP[i];
      dotY[i] += (mouseY - dotY[i]) * FOLLOW_LERP[i];

      // Orbit offset — sinusoidal swing layered on top for back-and-forth
      const phaseOffset = i * ((Math.PI * 2) / 3);
      const swing = isMouseDown
        ? Math.sin(time * ORBIT_SWING_FREQ * Math.PI * 2 + phaseOffset) * ORBIT_SWING
        : 0;
      const angle = orbitAngles[i] + i * ORBIT_PHASE + swing;
      const radius = isMouseDown ? ORBIT_RADIUS_DOWN : ORBIT_RADIUS;
      const ox = Math.cos(angle) * radius;
      const oy = Math.sin(angle) * radius;

      dot.style.transform = `translate(${dotX[i] + ox - half}px, ${dotY[i] + oy - half}px) scale(${dotScale})`;
    });
  });
}
