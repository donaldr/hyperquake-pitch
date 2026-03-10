import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { stats, pageKeyForEvent } from "./stats.js";

// ── Geometry extracted from Lottie eye.json at frame 90 ──────────────────────
// All coordinates in the 150×150 precomp space
const CX = 75;
const CY = 76.13;
const UPPER_CP = 40.77; // upper curve control-point Y (open)
const LOWER_CP = 100; // lower curve control-point Y (flatter bottom)
const IRIS_R = 25; // iris opening radius (from Lottie compound path)
const PUPIL_R = 11; // pupil radius

// ── Animation constants ──────────────────────────────────────────────────────
const MIN_BLINK = 1000;
const MAX_BLINK = 3000;
const BLINK_CLOSE = 0.18;
const BLINK_OPEN = 0.25;
const BLINK_HOLD_MAX = 0.2; // max seconds to hold closed (0 = no hold)
const BLINK_GAP = 0.0; // seconds between double blinks
const DOUBLE_BLINK_CHANCE = 0.3; // probability of a double blink (0–1)
const MOUSE_CLOSE = 5.2; // seconds for full hold-close
const MOUSE_OPEN = 1.2; // seconds to open on mouseup
const MOUSE_CLICK_THRESHOLD = 0.2; // max seconds to count as quick click
const MOUSE_BLINK_COOLDOWN = 0.5; // seconds to suppress blinks after mouseup
const CLOSE_UNTIL_SLEEP = 2.0; // seconds after fully closed before z's appear
const Z_INTERVAL = 0.6; // seconds between each new z
const Z_FLOAT_DURATION = 2.0; // seconds for a z to float up and fade
const Z_FONT_SIZE = 14; // starting font size for z's
// Max iris travel proportional to eye dimensions
const EYE_HALF_W = (125.7 - 24.3) / 2; // ~50.7
const EYE_HALF_H = (LOWER_CP - UPPER_CP) / 2; // ~29.6
const TRAVEL_FRAC = 0.95; // fraction of eye half-size the iris can travel
const PUPIL_MAX_X = EYE_HALF_W * TRAVEL_FRAC;
const PUPIL_MAX_Y = EYE_HALF_H * TRAVEL_FRAC;
const SKEW_AMOUNT = 10; // max CP offset for eye shape skew
const SQUINT_AMOUNT = 8; // max CP offset for vertical squint
const IRIS_FLATTEN = 0.55; // max scale reduction on the gaze axis (0 = none, 1 = flat)
const PUPIL_LEAD = 10; // extra px the pupil shifts toward gaze direction
const IRIS_SHRINK = 0.15; // max scale reduction of iris/pupil at full gaze
const MOUSE_HALF_VW = 50; // vw from eye center to reach 50% of max travel (lower = more responsive)

// ── Scene mode (idle) constants ─────────────────────────────────────────────
const IDLE_DELAY = 2000; // ms after last mouse move before easing to center
const IDLE_EASE_DURATION = 0.4; // seconds to ease iris back to center
const SCENE_MOVE_MIN = 0.08; // min seconds for rapid eye movement to new point
const SCENE_MOVE_MAX = 0.15; // max seconds for rapid eye movement
const SCENE_PAUSE_MIN = 0.3; // min seconds to hold at a point
const SCENE_PAUSE_MAX = 1.5; // max seconds to hold at a point
const SCENE_TRAVEL_FRAC = 0.7; // fraction of max travel for scene-mode targets
const REACQUIRE_SPEED = 0.25; // lerp factor per frame when snapping back to mouse from scene mode

// Open offsets: push lids beyond the eye shape + skew margin so no gaps show
const UPPER_OPEN = UPPER_CP - SKEW_AMOUNT;
const LOWER_OPEN = LOWER_CP + SKEW_AMOUNT;
const BG = "#e0e0e0";

const NS = "http://www.w3.org/2000/svg";

// ── Path builders (asymmetric left/right CPs) ───────────────────────────────
function eyePath(upperLeft, upperRight, lowerLeft, lowerRight) {
  const upperMid = (upperLeft + upperRight) / 2;
  const lowerMid = (lowerLeft + lowerRight) / 2;
  return (
    `M 125.7,${CY} C 125.7,${CY} 105.29,${lowerRight} 75,${lowerMid}` +
    ` C 44.71,${lowerLeft} 24.3,${CY} 24.3,${CY}` +
    ` C 24.3,${CY} 44.71,${upperLeft} 75,${upperMid}` +
    ` C 105.29,${upperRight} 125.7,${CY} 125.7,${CY} Z`
  );
}

function upperLidPath(cpLeft, cpRight) {
  const cpMid = (cpLeft + cpRight) / 2;
  return (
    `M -5,${CY} L 24.3,${CY} C 24.3,${CY} 44.71,${cpLeft} 75,${cpMid}` +
    ` C 105.29,${cpRight} 125.7,${CY} 125.7,${CY}` +
    ` L 155,${CY} L 155,-5 L -5,-5 Z`
  );
}

function lowerLidPath(cpLeft, cpRight) {
  const cpMid = (cpLeft + cpRight) / 2;
  return (
    `M 155,${CY} L 125.7,${CY} C 125.7,${CY} 105.29,${cpRight} 75,${cpMid}` +
    ` C 44.71,${cpLeft} 24.3,${CY} 24.3,${CY}` +
    ` L -5,${CY} L -5,155 L 155,155 Z`
  );
}

export function initEyeFollow() {
  const page = document.getElementById("page-03");
  if (!page) return;
  const container = page.querySelector(".eye-container");
  if (!container) return;

  let active = false;
  let blinkTimer = null;
  let isBlinking = false;
  let blinkTl = null; // current blink GSAP timeline (so we can kill it)
  let blinkT = 0; // current blink lid position (0 = open, 1 = closed)
  let mouseHeld = false;
  let mouseTl = null; // mouse-driven close/open timeline
  let wakeGrace = 0; // timestamp to ignore mousemove briefly after mouseup while sleeping
  let mouseX = 0,
    mouseY = 0;
  let idleTimer = null;
  let sceneMode = false;
  let sceneTl = null; // current scene GSAP timeline
  let targetX = 0, // the position updateIris reads (mouse or scene-driven)
    targetY = 0;
  let reacquiring = false; // true briefly after exiting scene mode
  let hasMouseMoved = false; // whether mouse has moved at all

  // Current skew state (updated each frame)
  let skewGazeX = 0; // -1 to 1

  // ── Build SVG ──────────────────────────────────────────────────────────────
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 150 150");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Clip path: eye shape (dynamic)
  const defs = document.createElementNS(NS, "defs");
  const clip = document.createElementNS(NS, "clipPath");
  clip.id = "eye-clip";
  const clipShape = document.createElementNS(NS, "path");
  clipShape.setAttribute("d", eyePath(UPPER_CP, UPPER_CP, LOWER_CP, LOWER_CP));
  clip.appendChild(clipShape);
  defs.appendChild(clip);

  // Inset shadow filter
  const shadowFilter = document.createElementNS(NS, "filter");
  shadowFilter.id = "eye-shadow";
  shadowFilter.setAttribute("x", "-50%");
  shadowFilter.setAttribute("y", "-50%");
  shadowFilter.setAttribute("width", "200%");
  shadowFilter.setAttribute("height", "200%");
  const blur = document.createElementNS(NS, "feGaussianBlur");
  blur.setAttribute("stdDeviation", "4");
  shadowFilter.appendChild(blur);
  defs.appendChild(shadowFilter);

  svg.appendChild(defs);

  const clipped = document.createElementNS(NS, "g");
  clipped.setAttribute("clip-path", "url(#eye-clip)");

  // White background (sclera)
  const sclera = document.createElementNS(NS, "rect");
  sclera.setAttribute("width", "150");
  sclera.setAttribute("height", "150");
  sclera.setAttribute("fill", "white");
  clipped.appendChild(sclera);

  // Iris + pupil group (moves with mouse)
  const irisGroup = document.createElementNS(NS, "g");

  // Large black circle — clipped to eye shape, creates the dark surround
  const irisDark = document.createElementNS(NS, "circle");
  irisDark.setAttribute("cx", CX);
  irisDark.setAttribute("cy", CY);
  irisDark.setAttribute("r", 120);
  irisDark.setAttribute("fill", "black");
  irisGroup.appendChild(irisDark);

  // White opening — the iris hole revealing sclera (ellipse for perspective flattening)
  const irisHole = document.createElementNS(NS, "ellipse");
  irisHole.setAttribute("cx", CX);
  irisHole.setAttribute("cy", CY);
  irisHole.setAttribute("rx", IRIS_R);
  irisHole.setAttribute("ry", IRIS_R);
  irisHole.setAttribute("fill", "white");
  irisGroup.appendChild(irisHole);

  // Pupil (ellipse, offset slightly more toward gaze for perspective)
  const pupil = document.createElementNS(NS, "ellipse");
  pupil.setAttribute("cx", CX);
  pupil.setAttribute("cy", CY);
  pupil.setAttribute("rx", PUPIL_R);
  pupil.setAttribute("ry", PUPIL_R);
  pupil.setAttribute("fill", "black");
  irisGroup.appendChild(pupil);

  clipped.appendChild(irisGroup);

  // Inset shadow along the eye edge
  const shadow = document.createElementNS(NS, "path");
  shadow.setAttribute("d", eyePath(UPPER_CP, UPPER_CP, LOWER_CP, LOWER_CP));
  shadow.setAttribute("fill", "none");
  shadow.setAttribute("stroke", "rgba(0,0,0,0.35)");
  shadow.setAttribute("stroke-width", "8");
  shadow.setAttribute("filter", "url(#eye-shadow)");
  shadow.setAttribute("pointer-events", "none");
  clipped.appendChild(shadow);

  svg.appendChild(clipped);

  // Blink eyelids ON TOP of everything — cover the entire eye during blink
  const upperLid = document.createElementNS(NS, "path");
  upperLid.setAttribute("fill", BG);
  upperLid.setAttribute("d", upperLidPath(UPPER_OPEN, UPPER_OPEN));
  svg.appendChild(upperLid);

  const lowerLid = document.createElementNS(NS, "path");
  lowerLid.setAttribute("fill", BG);
  lowerLid.setAttribute("d", lowerLidPath(LOWER_OPEN, LOWER_OPEN));
  svg.appendChild(lowerLid);

  container.appendChild(svg);

  // ── Skew helpers ───────────────────────────────────────────────────────────
  function skewedCPs(baseCP, gazeX) {
    // gazeX: -1 (looking left) to +1 (looking right)
    // Looking right → right side widens (CP moves away from CY), left narrows
    const isUpper = baseCP < CY;
    const sign = isUpper ? -1 : 1; // upper CPs go negative = wider, lower go positive = wider
    return {
      left: baseCP - sign * gazeX * SKEW_AMOUNT, // narrows on gaze side
      right: baseCP + sign * gazeX * SKEW_AMOUNT, // widens on gaze side
    };
  }

  function updateEyeShape(gazeX, gazeY) {
    // Vertical squint: looking down pulls upper CP toward CY, looking up pulls lower CP toward CY
    const upperBase = UPPER_CP + Math.max(0, gazeY) * SQUINT_AMOUNT; // only when looking down
    const lowerBase = LOWER_CP - Math.max(0, -gazeY) * SQUINT_AMOUNT; // only when looking up
    const upper = skewedCPs(upperBase, gazeX);
    const lower = skewedCPs(lowerBase, gazeX);
    const d = eyePath(upper.left, upper.right, lower.left, lower.right);
    clipShape.setAttribute("d", d);
    shadow.setAttribute("d", d);
  }

  // ── Blink ──────────────────────────────────────────────────────────────────
  function singleBlink(tl, proxy, { speedScale = 1, hold = true } = {}) {
    const speedJitter = 0.85 + Math.random() * 0.3;
    tl.to(proxy, {
      t: 1,
      duration: (BLINK_CLOSE * speedJitter) / speedScale,
      ease: "power2.in",
      onUpdate: () => updateBlinkLids(proxy.t),
    });
    // Random hold while closed
    if (hold) {
      const holdDur = Math.random() * BLINK_HOLD_MAX;
      if (holdDur > 0.01) {
        tl.to(proxy, { t: 1, duration: holdDur });
      }
    }
    tl.to(proxy, {
      t: 0,
      duration: (BLINK_OPEN * speedJitter) / speedScale,
      ease: "power2.out",
      onUpdate: () => updateBlinkLids(proxy.t),
    });
  }

  function blink() {
    if (isBlinking || mouseHeld || !active) return;
    isBlinking = true;

    const proxy = { t: blinkT };
    blinkTl = gsap.timeline({
      onUpdate: () => {
        blinkT = proxy.t;
      },
      onComplete: () => {
        blinkTl = null;
        isBlinking = false;
        blinkT = 0;
        scheduleRandomBlink();
      },
    });

    const isDouble = Math.random() < DOUBLE_BLINK_CHANCE;

    if (isDouble) {
      singleBlink(blinkTl, proxy, { speedScale: 2, hold: false });
      blinkTl.to(proxy, { t: 0, duration: BLINK_GAP }); // brief gap
      singleBlink(blinkTl, proxy, { speedScale: 2 });
    } else {
      singleBlink(blinkTl, proxy);
    }
  }

  function updateBlinkLids(t) {
    // Upper lid does ~85% of travel, lower lid ~15%, with slight overlap to avoid gap
    const overlap = 1.5;
    const midY = CY + (LOWER_CP - CY) * 0.15;
    const upperCpY = UPPER_OPEN + t * (midY - UPPER_OPEN + overlap);
    const lowerCpY = LOWER_OPEN + t * (midY - LOWER_OPEN - overlap);
    // Use current skew for the blink lids too
    const upperSkew = skewedCPs(upperCpY, skewGazeX);
    const lowerSkew = skewedCPs(lowerCpY, skewGazeX);
    // Update clip path to follow the lids
    const clipUpper = Math.min(upperCpY, UPPER_CP);
    const clipLower = Math.max(lowerCpY, LOWER_CP);
    const clipUpperSkew = skewedCPs(clipUpper, skewGazeX);
    const clipLowerSkew = skewedCPs(clipLower, skewGazeX);
    clipShape.setAttribute(
      "d",
      eyePath(
        clipUpperSkew.left,
        clipUpperSkew.right,
        clipLowerSkew.left,
        clipLowerSkew.right,
      ),
    );

    upperLid.setAttribute("d", upperLidPath(upperSkew.left, upperSkew.right));
    lowerLid.setAttribute("d", lowerLidPath(lowerSkew.left, lowerSkew.right));
  }

  // ── Mouse tracking ─────────────────────────────────────────────────────────
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(enterSceneMode, IDLE_DELAY);
  }

  let lastMoveTime = 0;
  function onMouseMove(e) {
    if (!active) return;
    if (sleeping && !mouseHeld && performance.now() - wakeGrace > 100) {
      wakeUp();
      return;
    }

    const now = performance.now();
    if (lastMoveTime > 0 && pageKeyForEvent(e) === "page03") {
      stats.page03.mouseMovingDuration += (now - lastMoveTime) / 1000;
    }
    lastMoveTime = now;

    const rect = svg.getBoundingClientRect();
    const eyeScreenCX = rect.left + rect.width * (CX / 150);
    const eyeScreenCY = rect.top + rect.height * (CY / 150);
    mouseX = e.clientX - eyeScreenCX;
    mouseY = e.clientY - eyeScreenCY;

    hasMouseMoved = true;

    // Exit scene mode on mouse movement
    if (sceneMode) {
      exitSceneMode();
      reacquiring = true;
    }
    if (!reacquiring) {
      targetX = mouseX;
      targetY = mouseY;
    }
    resetIdleTimer();
  }

  // ── Scene mode ────────────────────────────────────────────────────────────
  function enterSceneMode() {
    if (!active || sceneMode) return;
    sceneMode = true;
    // Ease to center first, then start random movements
    const proxy = { x: targetX, y: targetY };
    sceneTl = gsap.timeline();
    sceneTl.to(proxy, {
      x: 0,
      y: 0,
      duration: IDLE_EASE_DURATION,
      ease: "power2.inOut",
      onUpdate: () => {
        targetX = proxy.x;
        targetY = proxy.y;
      },
      onComplete: () => scheduleSceneMove(proxy),
    });
  }

  function scheduleSceneMove(proxy) {
    if (!active || !sceneMode) return;
    const pause =
      SCENE_PAUSE_MIN + Math.random() * (SCENE_PAUSE_MAX - SCENE_PAUSE_MIN);
    const moveDur =
      SCENE_MOVE_MIN + Math.random() * (SCENE_MOVE_MAX - SCENE_MOVE_MIN);

    // Random target within scene travel bounds (in screen-space px)
    const halfDist = (MOUSE_HALF_VW / 100) * window.innerWidth;
    const maxScreen = halfDist * SCENE_TRAVEL_FRAC;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * maxScreen;
    const nx = Math.cos(angle) * radius;
    const ny = Math.sin(angle) * radius;

    sceneTl = gsap.timeline();
    // Hold at current position
    sceneTl.to(proxy, { duration: pause });
    // Rapid move to new point
    sceneTl.to(proxy, {
      x: nx,
      y: ny,
      duration: moveDur,
      ease: "power3.inOut",
      onUpdate: () => {
        targetX = proxy.x;
        targetY = proxy.y;
      },
      onComplete: () => scheduleSceneMove(proxy),
    });
  }

  function exitSceneMode() {
    sceneMode = false;
    if (sceneTl) {
      sceneTl.kill();
      sceneTl = null;
    }
  }

  function applyGaze(dx, dy) {
    gsap.set(irisGroup, { x: dx, y: dy });

    const gazeX = dx / PUPIL_MAX_X;
    const gazeY = dy / PUPIL_MAX_Y;
    const gazeLen = Math.sqrt(gazeX * gazeX + gazeY * gazeY);
    const flatten = Math.min(gazeLen, 1) * IRIS_FLATTEN;

    const absGX = Math.abs(gazeX);
    const absGY = Math.abs(gazeY);
    const shrink = 1 - Math.min(gazeLen, 1) * IRIS_SHRINK;
    const irisRx = IRIS_R * shrink * (1 - flatten * absGX);
    const irisRy = IRIS_R * shrink * (1 - flatten * absGY);
    const pupilRx = PUPIL_R * shrink * (1 - flatten * absGX);
    const pupilRy = PUPIL_R * shrink * (1 - flatten * absGY);

    irisHole.setAttribute("rx", irisRx);
    irisHole.setAttribute("ry", irisRy);
    pupil.setAttribute("rx", pupilRx);
    pupil.setAttribute("ry", pupilRy);

    const leadX = gazeX * PUPIL_LEAD;
    const leadY = gazeY * PUPIL_LEAD;
    gsap.set(pupil, { x: leadX, y: leadY });
    skewGazeX = gazeX;

    updateEyeShape(gazeX, gazeY);
  }

  function updateIris() {
    if (!active) return;

    // Lerp toward mouse when reacquiring after scene mode
    if (reacquiring) {
      targetX += (mouseX - targetX) * REACQUIRE_SPEED;
      targetY += (mouseY - targetY) * REACQUIRE_SPEED;
      const gap = Math.abs(mouseX - targetX) + Math.abs(mouseY - targetY);
      if (gap < 1) {
        reacquiring = false;
        targetX = mouseX;
        targetY = mouseY;
      }
    }

    const dist = Math.sqrt(targetX * targetX + targetY * targetY);

    let dx = 0,
      dy = 0;
    if (dist > 0) {
      const halfDist = (MOUSE_HALF_VW / 100) * window.innerWidth;
      const t = dist / (dist + halfDist);
      dx = (targetX / dist) * PUPIL_MAX_X * t;
      dy = (targetY / dist) * PUPIL_MAX_Y * t;
    }

    applyGaze(dx, dy);

    requestAnimationFrame(updateIris);
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────
  function scheduleRandomBlink() {
    if (!active) return;
    clearTimeout(blinkTimer);
    const delay = MIN_BLINK + Math.random() * (MAX_BLINK - MIN_BLINK);
    blinkTimer = setTimeout(blink, delay);
  }

  let mouseDownTime = 0;

  let holdCloseTimer = null;

  // Drowsy close: fast droop → slow fight → small droop → slow fight → final close
  const DROWSY_SEGMENTS = [
    { t: 0.35, dur: 0.12, ease: "power2.out" }, // quick initial droop
    { t: 0.3, dur: 0.2, ease: "power1.inOut" }, // fight back open slightly
    { t: 0.55, dur: 0.15, ease: "power2.out" }, // droop further
    { t: 0.45, dur: 0.18, ease: "power1.inOut" }, // fight back again
    { t: 0.75, dur: 0.12, ease: "power2.out" }, // heavy droop
    { t: 0.65, dur: 0.1, ease: "power1.inOut" }, // barely fights
    { t: 1.0, dur: 0.13, ease: "power3.in" }, // gives in, closes
  ];

  function startHoldClose() {
    stats.page03.eyeCloses++;
    if (mouseTl) mouseTl.kill();

    const proxy = { t: blinkT };
    const onUpdate = () => {
      blinkT = proxy.t;
      updateBlinkLids(blinkT);
    };

    mouseTl = gsap.timeline({
      onComplete: () => {
        // Eye fully closed — start sleep timer
        sleepTimer = setTimeout(startSleepZs, CLOSE_UNTIL_SLEEP * 1000);
      },
    });
    for (const seg of DROWSY_SEGMENTS) {
      const scaledDur = seg.dur * MOUSE_CLOSE;
      mouseTl.to(proxy, {
        t: seg.t,
        duration: scaledDur,
        ease: seg.ease,
        onUpdate,
      });
    }
  }

  // ── Sleep z's ───────────────────────────────────────────────────────────────
  let sleepTimer = null;
  let zInterval = null;
  const activeZs = [];

  function spawnZ() {
    const wrap = page.querySelector(".eye-wrap");
    const wrapRect = wrap.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();

    const el = document.createElement("span");
    el.className = "sleep-z";
    el.textContent = "z";
    const size = Z_FONT_SIZE * (0.6 + Math.random() * 0.8);
    el.style.fontSize = `${size}px`;
    // Position at top-right of the eye, in px relative to page
    const startX = wrapRect.left + wrapRect.width / 2 - pageRect.left;
    const startY = wrapRect.top + wrapRect.height / 2 - pageRect.top;
    el.style.left = `${startX}px`;
    el.style.top = `${startY}px`;
    page.appendChild(el);

    el.style.opacity = "0";
    const tween = gsap.timeline({
      onComplete: () => {
        el.remove();
        const idx = activeZs.indexOf(tween);
        if (idx >= 0) activeZs.splice(idx, 1);
      },
    });
    // Float up, scale, rotate over full duration
    tween.to(
      el,
      {
        y: -(40 + Math.random() * 30),
        x: 20 + Math.random() * 40,
        scale: 1.5 + Math.random(),
        rotation: -15 + Math.random() * 30,
        duration: Z_FLOAT_DURATION,
        ease: "power1.out",
      },
      0,
    );
    // Fade in quickly at start
    tween.to(el, { opacity: 0.5, duration: 0.2, ease: "power1.in" }, 0);
    // Fade out near end
    tween.to(
      el,
      { opacity: 0, duration: Z_FLOAT_DURATION * 0.4, ease: "power1.in" },
      Z_FLOAT_DURATION * 0.6,
    );
    activeZs.push(tween);
  }

  function startSleepZs() {
    sleeping = true;
    stats.page03.eyeSleeps++;
    spawnZ();
    zInterval = setInterval(spawnZ, Z_INTERVAL * 1000);
  }

  let sleeping = false;

  function stopSleepZs() {
    clearTimeout(sleepTimer);
    sleepTimer = null;
    clearInterval(zInterval);
    zInterval = null;
    // Let existing z's finish their float animation naturally
  }

  function wakeUp() {
    if (!sleeping) return;
    sleeping = false;
    stopSleepZs();

    // Open the eye
    if (mouseTl) mouseTl.kill();
    const proxy = { t: blinkT };
    mouseTl = gsap.to(proxy, {
      t: 0,
      duration: MOUSE_OPEN * blinkT,
      ease: "power2.out",
      onUpdate: () => {
        blinkT = proxy.t;
        updateBlinkLids(blinkT);
      },
      onComplete: () => {
        mouseTl = null;
        blinkT = 0;
        clearTimeout(blinkTimer);
        blinkTimer = setTimeout(() => {
          scheduleRandomBlink();
        }, MOUSE_BLINK_COOLDOWN * 1000);
      },
    });
  }

  function onMouseDown() {
    if (!active) return;
    mouseHeld = true;
    mouseDownTime = performance.now();

    // Kill any active auto-blink, interpolate from current position
    if (blinkTl) {
      blinkTl.kill();
      blinkTl = null;
      isBlinking = false;
    }
    clearTimeout(blinkTimer);
    if (mouseTl) mouseTl.kill();

    // Wait just past click threshold before starting slow close
    clearTimeout(holdCloseTimer);
    holdCloseTimer = setTimeout(() => {
      if (mouseHeld) {
        console.log(
          "hold close starting:",
          ((performance.now() - mouseDownTime) / 1000).toFixed(3) +
            "s after mousedown",
        );
        startHoldClose();
      }
    }, MOUSE_CLICK_THRESHOLD * 1000);
  }

  function onMouseUp() {
    if (!mouseHeld) return;
    mouseHeld = false;
    clearTimeout(holdCloseTimer);
    clearTimeout(sleepTimer);

    // If sleeping, stay asleep — ignore mousemove briefly after release
    if (sleeping) {
      wakeGrace = performance.now();
      return;
    }
    const elapsed = (performance.now() - mouseDownTime) / 1000;
    console.log(
      "mousedown → mouseup:",
      elapsed.toFixed(3) + "s, blinkT:",
      blinkT.toFixed(3),
    );

    if (mouseTl) mouseTl.kill();

    if (elapsed < MOUSE_CLICK_THRESHOLD) {
      stats.page03.blinkClicks++;
      // Quick click: do a fast blink from current position
      const proxy = { t: blinkT };
      mouseTl = gsap.timeline({
        onComplete: () => {
          mouseTl = null;
          blinkT = 0;
          clearTimeout(blinkTimer);
          blinkTimer = setTimeout(() => {
            scheduleRandomBlink();
          }, MOUSE_BLINK_COOLDOWN * 1000);
        },
      });
      // Close quickly
      mouseTl.to(proxy, {
        t: 1,
        duration: BLINK_CLOSE * (1 - blinkT),
        ease: "power2.in",
        onUpdate: () => {
          blinkT = proxy.t;
          updateBlinkLids(blinkT);
        },
      });
      // Open quickly
      mouseTl.to(proxy, {
        t: 0,
        duration: BLINK_OPEN,
        ease: "power2.out",
        onUpdate: () => {
          blinkT = proxy.t;
          updateBlinkLids(blinkT);
        },
      });
    } else {
      // Held: open quickly from current position
      const proxy = { t: blinkT };
      mouseTl = gsap.to(proxy, {
        t: 0,
        duration: MOUSE_OPEN * blinkT,
        ease: "power2.out",
        onUpdate: () => {
          blinkT = proxy.t;
          updateBlinkLids(blinkT);
        },
        onComplete: () => {
          mouseTl = null;
          blinkT = 0;
          clearTimeout(blinkTimer);
          blinkTimer = setTimeout(() => {
            scheduleRandomBlink();
          }, MOUSE_BLINK_COOLDOWN * 1000);
        },
      });
    }
  }

  // ── ScrollTrigger ──────────────────────────────────────────────────────────
  ScrollTrigger.create({
    trigger: page,
    start: "top 60%",
    end: "top -20%",
    onEnter: activate,
    onLeave: deactivate,
    onEnterBack: activate,
    onLeaveBack: deactivate,
  });

  function activate() {
    active = true;
    scheduleRandomBlink();
    if (hasMouseMoved) {
      resetIdleTimer();
    } else {
      enterSceneMode();
    }
    window.addEventListener("mousemove", onMouseMove);
    page.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    requestAnimationFrame(updateIris);
  }

  function deactivate() {
    active = false;
    if (sleeping) {
      sleeping = false;
      stopSleepZs();
    }
    clearTimeout(blinkTimer);
    clearTimeout(holdCloseTimer);
    clearTimeout(idleTimer);
    exitSceneMode();
    window.removeEventListener("mousemove", onMouseMove);
    page.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    if (mouseTl) {
      mouseTl.kill();
      mouseTl = null;
    }
    mouseHeld = false;
    blinkT = 0;
  }
}
