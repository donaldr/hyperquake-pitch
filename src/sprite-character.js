// ── Sprite Character ──────────────────────────────────────────────────────────
// WASD-controlled robot that hovers near the AI panel.
// Sprite sheets: 5×5 grids, 256×256 per frame, 25 frames each.

import { isMuted } from "./audio-state.js";
import { stats } from "./stats.js";

// ── Rocket thrust sound ──
const ROCKET_FREQ = 90;
const ROCKET_VOLUME = 0.5;
const ROCKET_FADE = 0.08; // seconds for fade in/out

// ── Sheet layout ──
const SHEET_COLS = 5;
const FRAME_W = 256;
const FRAME_H = 256;

// ── Playback ──
const FPS = 16;
const DISPLAY_SIZE = 128; // rendered size on screen

// ── Physics ──
const ACCELERATION = 0.7; // px/frame² while key held
const DECELERATION = 0.7; // px/frame² after key released
const MAX_SPEED = 10; // px/frame top speed
const GRAVITY = 0.5; // px/frame² downward pull
const THRUST = 1.0; // px/frame² upward force (W key)
const MAX_FALL = 100; // px/frame terminal velocity

// ── Collision box (inset from DISPLAY_SIZE edges) ──
const HIT_W = 80; // collision width (px)
const HIT_H = 95; // collision height (px)

// ── Frame sequences (edit these to match your sprite sheets) ──
// Each is an array of frame indices (0-24, left-to-right top-to-bottom)

// Idle (hover-in-place.png) — loops continuously
const IDLE_FRAMES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24,
];

// Move (hover-move.png) — intro plays once, loop repeats, outro plays once on release
const MOVE_INTRO_FRAMES = [8, 9, 10, 11];
const MOVE_LOOP_FRAMES = [13, 14, 15, 16];
const MOVE_OUTRO_FRAMES = [17, 18, 19, 20, 21, 22, 23, 24];

// Quick reversal (direction change while already moving)
const MOVE_QUICK_INTRO_FRAMES = [8, 9, 10, 11];
const MOVE_QUICK_OUTRO_FRAMES = [17, 18, 19, 20];

// Vertical move (hover-move.png) — intro plays once, loop repeats, outro plays once on release
const VERT_INTRO_FRAMES = [4, 5, 6];
const VERT_LOOP_FRAMES = [6, 7, 6, 5];
const VERT_OUTRO_FRAMES = [5, 4, 3];

// Talk (talk.png) — random segments play as one-shot boomerangs while typing
const TALK_FRAMES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24,
];
const TALK_MIN_SEGMENT = 4; // min frames per one-shot boomerang
const TALK_MAX_SEGMENT = 8; // max frames per one-shot boomerang

// ── Mouth overlay ──
// Mouth sprite sheet: 4×4 grid, 64×64 per frame, 16 frames
const MOUTH_COLS = 4;
const MOUTH_FRAME_W = 64;
const MOUTH_FRAME_H = 64;
const MOUTH_DISPLAY = MOUTH_FRAME_W * (DISPLAY_SIZE / FRAME_W); // scale to match body
const MOUTH_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// Mouth placement per body frame index — { x, y } relative to frame center, rot in degrees
// x/y are in source-pixel space (0-256), will be scaled to display size

const MOVE_MOUTH = {
  0: { x: 128, y: 105, rot: 0 },
  1: { x: 128, y: 104, rot: 0 },
  2: { x: 128, y: 103, rot: 0 },
  3: { x: 128, y: 102, rot: 0 },
  4: { x: 128, y: 101, rot: 0 },
  5: { x: 128, y: 100, rot: 0 },
  6: { x: 128, y: 98, rot: 0 },
  7: { x: 129, y: 97, rot: 2 },
  8: { x: 131, y: 96, rot: 5 },
  9: { x: 135, y: 96, rot: 13 },
  10: { x: 141, y: 96, rot: 21 },
  11: { x: 145, y: 97, rot: 27 },
  12: { x: 147, y: 97, rot: 31 },
  13: { x: 149, y: 99, rot: 35 },
  14: { x: 149, y: 100, rot: 38 },
  15: { x: 149, y: 101, rot: 39 },
  16: { x: 148, y: 102, rot: 40 },
  17: { x: 149, y: 100, rot: 40 },
  18: { x: 147, y: 98, rot: 34 },
  19: { x: 140, y: 97, rot: 22 },
  20: { x: 131, y: 97, rot: 4 },
  21: { x: 129, y: 99, rot: 0 },
  22: { x: 128, y: 100, rot: 0 },
  23: { x: 128, y: 103, rot: 0 },
  24: { x: 128, y: 105, rot: 0 },
};

// ── Debug mode for mouth placement tuning ──
const DEBUG_MOUTH = false; // set true for mouth placement tuning
let debugMoveFrame = 0; // current MOVE frame being tuned (0-24)

const SPRITE_SHEETS = {
  idle: "/sprites/hover-in-place.png",
  move: "/sprites/hover-move.png",
  talk: "/sprites/talk.png",
  mouth: "/sprites/mouths.png",
};

export function initSpriteCharacter(page, panel) {
  const canvas = document.createElement("canvas");
  canvas.width = DISPLAY_SIZE;
  canvas.height = DISPLAY_SIZE;
  canvas.style.cssText = `
    position: absolute;
    z-index: 10;
    pointer-events: none;
  `;
  page.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // ── Rocket thrust sound (noise-based, gain + filter modulated by velocity) ──
  let rocketCtx = null;
  let rocketGain = null;
  let rocketFilter = null;
  let rocketStarted = false;

  function ensureRocket() {
    if (rocketCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    rocketCtx = new AC();

    // Create white noise buffer
    const bufLen = rocketCtx.sampleRate * 2;
    const buf = rocketCtx.createBuffer(1, bufLen, rocketCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const noise = rocketCtx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    // Bandpass filter to shape the noise into a rumbly rocket tone
    rocketFilter = rocketCtx.createBiquadFilter();
    rocketFilter.type = "bandpass";
    rocketFilter.frequency.value = ROCKET_FREQ;
    rocketFilter.Q.value = 0.8;

    rocketGain = rocketCtx.createGain();
    rocketGain.gain.value = 0;

    noise.connect(rocketFilter);
    rocketFilter.connect(rocketGain);
    rocketGain.connect(rocketCtx.destination);
    noise.start();
    rocketStarted = true;
  }

  let touchingWallX = false; // currently pressed against left/right wall
  let touchingWallPanel = false; // currently pressed against panel side

  function playBonk() {
    if (!rocketCtx || isMuted()) return;
    const now = rocketCtx.currentTime;
    // Short pitched-down chirp with random detune
    const baseFreq = 250 + Math.random() * 100; // 250-350 Hz
    const osc = rocketCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(
      60 + Math.random() * 40,
      now + 0.1,
    );
    const g = rocketCtx.createGain();
    g.gain.setValueAtTime(0.4, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g);
    g.connect(rocketCtx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  function updateRocketSound() {
    if (!rocketStarted || isMuted()) {
      if (rocketGain)
        rocketGain.gain.cancelScheduledValues(rocketCtx.currentTime);
      if (rocketGain) rocketGain.gain.setValueAtTime(0, rocketCtx.currentTime);
      return;
    }
    const moving = keys.w || keys.a || keys.s || keys.d;
    const target = moving ? ROCKET_VOLUME : 0;
    rocketGain.gain.cancelScheduledValues(rocketCtx.currentTime);
    rocketGain.gain.setTargetAtTime(target, rocketCtx.currentTime, ROCKET_FADE);
  }

  // Load sprite sheets
  const images = {};
  const loaded = {};
  for (const [key, src] of Object.entries(SPRITE_SHEETS)) {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      loaded[key] = true;
    };
    images[key] = img;
  }

  // Position: start on top of panel
  const panelRect = () => panel.getBoundingClientRect();
  const pageRect = () => page.getBoundingClientRect();

  let x = 0;
  let y = 0;
  let positioned = false;

  function positionAtPanel() {
    const pr = pageRect();
    const plr = panelRect();
    x = plr.left - pr.left - (DISPLAY_SIZE - HIT_W) / 2;
    y = plr.top - pr.top - DISPLAY_SIZE;
    grounded = true;
    positioned = true;
  }

  // State
  let frame = 0;
  let frameTimer = 0;
  let facingLeft = false;

  // Movement
  const keys = { w: false, a: false, s: false, d: false };
  let vx = 0; // horizontal velocity
  let vy = 0; // vertical velocity
  let grounded = false; // standing on a surface
  let movePhase = "none"; // "none" | "intro" | "loop" | "outro"
  let moveIndex = 0; // index into the current MOVE_*_FRAMES array
  let moveDir = 0; // -1 = left, 1 = right, 0 = none (direction when anim started)
  let vertPhase = "none"; // "none" | "intro" | "loop" | "outro"
  let vertIndex = 0; // index into the current VERT_*_FRAMES array

  // Talking
  let isTalking = false;
  let talkSegment = []; // current boomerang frame sequence (talk sheet)
  let talkSegIndex = 0;
  let mouthSegment = []; // current boomerang frame sequence (mouth sheet)
  let mouthSegIndex = 0;

  function startTalkSegment() {
    const len =
      TALK_MIN_SEGMENT +
      Math.floor(Math.random() * (TALK_MAX_SEGMENT - TALK_MIN_SEGMENT + 1));
    // Talk sheet boomerang
    const maxStart = TALK_FRAMES.length - len;
    const start = Math.floor(Math.random() * (maxStart + 1));
    const forward = TALK_FRAMES.slice(start, start + len);
    const back = forward.slice(0, -1).reverse();
    talkSegment = [...forward, ...back];
    talkSegIndex = 0;
    // Mouth sheet boomerang (same length, different frame pool)
    const mLen = Math.min(len, MOUTH_FRAMES.length);
    const mMaxStart = MOUTH_FRAMES.length - mLen;
    const mStart = Math.floor(Math.random() * (mMaxStart + 1));
    const mForward = MOUTH_FRAMES.slice(mStart, mStart + mLen);
    const mBack = mForward.slice(0, -1).reverse();
    mouthSegment = [...mForward, ...mBack];
    mouthSegIndex = 0;
  }

  // Key handlers — scoped to page visibility
  function isFormInput(e) {
    const tag = e.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function onKeyDown(e) {
    if (isFormInput(e)) return;
    const k = e.key.toLowerCase();
    if (k in keys) {
      keys[k] = true;
      ensureRocket();
      stats.page05.wasdPresses++;
      e.preventDefault();
    }
  }
  function onKeyUp(e) {
    if (isFormInput(e)) return;
    const k = e.key.toLowerCase();
    if (k in keys) {
      keys[k] = false;
      e.preventDefault();
    }
  }
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // ── Debug mouth tuning keys ──
  if (DEBUG_MOUTH) {
    isTalking = true;
    startTalkSegment();

    function logMouthMap() {
      const lines = ["const MOVE_MOUTH = {"];
      for (let i = 0; i <= 24; i++) {
        const m = MOVE_MOUTH[i];
        const pad = i < 10 ? " " : "";
        lines.push(`  ${pad}${i}: { x: ${m.x}, y: ${m.y}, rot: ${m.rot} },`);
      }
      lines.push("};");
      console.log(lines.join("\n"));
    }

    document.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "+" || k === "=") {
        debugMoveFrame = Math.min(24, debugMoveFrame + 1);
        console.log("MOVE frame:", debugMoveFrame);
        e.preventDefault();
      } else if (k === "-" || k === "_") {
        debugMoveFrame = Math.max(0, debugMoveFrame - 1);
        console.log("MOVE frame:", debugMoveFrame);
        e.preventDefault();
      } else if (k === "i") {
        MOVE_MOUTH[debugMoveFrame].y -= 1;
        console.log(`Frame ${debugMoveFrame}:`, MOVE_MOUTH[debugMoveFrame]);
        e.preventDefault();
      } else if (k === "k") {
        MOVE_MOUTH[debugMoveFrame].y += 1;
        console.log(`Frame ${debugMoveFrame}:`, MOVE_MOUTH[debugMoveFrame]);
        e.preventDefault();
      } else if (k === "j") {
        MOVE_MOUTH[debugMoveFrame].x -= 1;
        console.log(`Frame ${debugMoveFrame}:`, MOVE_MOUTH[debugMoveFrame]);
        e.preventDefault();
      } else if (k === "l") {
        MOVE_MOUTH[debugMoveFrame].x += 1;
        console.log(`Frame ${debugMoveFrame}:`, MOVE_MOUTH[debugMoveFrame]);
        e.preventDefault();
      } else if (k === "u") {
        MOVE_MOUTH[debugMoveFrame].rot -= 1;
        console.log(`Frame ${debugMoveFrame}:`, MOVE_MOUTH[debugMoveFrame]);
        e.preventDefault();
      } else if (k === "o") {
        MOVE_MOUTH[debugMoveFrame].rot += 1;
        console.log(`Frame ${debugMoveFrame}:`, MOVE_MOUTH[debugMoveFrame]);
        e.preventDefault();
      } else if (k === ".") {
        logMouthMap();
        e.preventDefault();
      }
    });
  }

  function isAirborne() {
    return !grounded;
  }

  function getFrameCoords(f) {
    const col = f % SHEET_COLS;
    const row = Math.floor(f / SHEET_COLS);
    return { sx: col * FRAME_W, sy: row * FRAME_H };
  }

  function getMouthFrameCoords(f) {
    const col = f % MOUTH_COLS;
    const row = Math.floor(f / MOUTH_COLS);
    return { sx: col * MOUTH_FRAME_W, sy: row * MOUTH_FRAME_H };
  }

  function drawFrame(sheet, f, flip) {
    if (!loaded[sheet]) return;
    const { sx, sy } = getFrameCoords(f);
    ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    ctx.save();
    if (flip) {
      ctx.translate(DISPLAY_SIZE, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(
      images[sheet],
      sx,
      sy,
      FRAME_W,
      FRAME_H,
      0,
      0,
      DISPLAY_SIZE,
      DISPLAY_SIZE,
    );

    // Mouth overlay (only when talking, on move sheet, and mouth sheet is loaded)
    if (isTalking && !isMuted() && loaded.mouth && sheet === "move") {
      const mouthMap = MOVE_MOUTH;
      const placement = mouthMap[f];
      if (placement) {
        const mouthFrame = mouthSegment[mouthSegIndex] ?? 0;
        const mc = getMouthFrameCoords(mouthFrame);
        const scale = DISPLAY_SIZE / FRAME_W;
        const dx = placement.x * scale - MOUTH_DISPLAY / 2;
        const dy = placement.y * scale - MOUTH_DISPLAY / 2;

        ctx.save();
        if (placement.rot !== 0) {
          ctx.translate(placement.x * scale, placement.y * scale);
          ctx.rotate((placement.rot * Math.PI) / 180);
          ctx.translate(-placement.x * scale, -placement.y * scale);
        }
        ctx.drawImage(
          images.mouth,
          mc.sx,
          mc.sy,
          MOUTH_FRAME_W,
          MOUTH_FRAME_H,
          dx,
          dy,
          MOUTH_DISPLAY,
          MOUTH_DISPLAY,
        );
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function update() {
    if (!positioned) positionAtPanel();

    // Horizontal velocity
    if (keys.a) {
      vx = Math.max(-MAX_SPEED, vx - ACCELERATION);
    } else if (keys.d) {
      vx = Math.min(MAX_SPEED, vx + ACCELERATION);
    } else {
      // Decelerate toward zero
      if (vx > 0) vx = Math.max(0, vx - DECELERATION);
      else if (vx < 0) vx = Math.min(0, vx + DECELERATION);
    }

    // Vertical: gravity + thrust
    if (keys.w) {
      vy -= THRUST;
      grounded = false;
    }
    if (keys.s) {
      vy += ACCELERATION;
    }
    vy = Math.min(MAX_FALL, vy + GRAVITY);
    vy = Math.max(-MAX_SPEED, vy);

    x += vx;
    y += vy;
    updateRocketSound();

    // Hitbox inset from sprite edges (centered)
    const hOffX = (DISPLAY_SIZE - HIT_W) / 2;
    const hOffY = (DISPLAY_SIZE - HIT_H) / 2;
    // Hitbox bounds: left = x + hOffX, right = x + hOffX + HIT_W, etc.

    // Page bounds
    const pr = page.getBoundingClientRect();
    const prevX = x;
    const minX = -hOffX; // so hitbox left edge = 0
    const maxX = pr.width - HIT_W - hOffX; // so hitbox right edge = pr.width
    x = Math.max(minX, Math.min(maxX, x));
    if (x !== prevX) {
      if (!touchingWallX && Math.abs(vx) > 1) playBonk();
      touchingWallX = true;
    } else {
      touchingWallX = false;
    }

    // Floor (bottom of page)
    const wasGrounded = grounded;
    grounded = false; // reset each frame; set true below if on a surface
    const floor = pr.height - HIT_H - hOffY; // so hitbox bottom = page bottom
    if (y >= floor) {
      y = floor;
      if (!wasGrounded && vy > 1) playBonk();
      vy = 0;
      grounded = true;
    }

    // Panel collision — treat panel as a solid box (in page-relative coords)
    const pgr = pageRect();
    const plr = panelRect();
    const panelL = plr.left - pgr.left;
    const panelR = plr.right - pgr.left;
    const panelT = plr.top - pgr.top;
    const panelB = plr.bottom - pgr.top;

    // Check overlap using hitbox
    const hL = x + hOffX;
    const hR = x + hOffX + HIT_W;
    const hT = y + hOffY;
    const hB = y + hOffY + HIT_H;
    const overlapX = hR > panelL && hL < panelR;
    const overlapY = hB > panelT && hT < panelB;

    if (overlapX && overlapY) {
      // Find smallest push-out distance for each side
      const pushUp = hB - panelT;
      const pushDown = panelB - hT;
      const pushLeft = hR - panelL;
      const pushRight = panelR - hL;

      const minPush = Math.min(pushUp, pushDown, pushLeft, pushRight);

      if (minPush === pushUp) {
        y = panelT - HIT_H - hOffY;
        if (!touchingWallPanel && vy > 1) playBonk();
        if (vy > 0) vy = 0;
        grounded = true;
      } else if (minPush === pushDown) {
        y = panelB - hOffY;
        if (!touchingWallPanel && vy < -1) playBonk();
        if (vy < 0) vy = 0;
      } else if (minPush === pushLeft) {
        x = panelL - HIT_W - hOffX;
        if (!touchingWallPanel && vx > 1) playBonk();
        if (vx > 0) vx = 0;
      } else {
        x = panelR - hOffX;
        if (!touchingWallPanel && vx < -1) playBonk();
        if (vx < 0) vx = 0;
      }
      touchingWallPanel = true;
    } else {
      touchingWallPanel = false;
    }

    canvas.style.left = x + "px";
    canvas.style.top = y + "px";

    // Frame timing
    frameTimer++;
    if (frameTimer < 60 / FPS) return;
    frameTimer = 0;

    // Advance talk + mouth boomerangs independently (mouth overlay works on any animation)
    if (isTalking) {
      talkSegIndex++;
      mouthSegIndex++;
      if (
        talkSegIndex >= talkSegment.length ||
        mouthSegIndex >= mouthSegment.length
      ) {
        startTalkSegment();
      }
    }

    // Debug mode: show static MOVE frame with animating mouth, skip normal state machine
    if (DEBUG_MOUTH) {
      drawFrame("move", debugMoveFrame, false);
      return;
    }

    // Determine current press direction
    const pressDir = keys.a ? -1 : keys.d ? 1 : 0;

    // Determine which animation to play

    // Quick outro/intro always play to completion regardless of key state
    if (movePhase === "quick-outro") {
      drawFrame("move", MOVE_QUICK_OUTRO_FRAMES[moveIndex], facingLeft);
      moveIndex++;
      if (moveIndex >= MOVE_QUICK_OUTRO_FRAMES.length) {
        if (pressDir !== 0) {
          // Key still held: flip and start quick intro
          movePhase = "quick-intro";
          moveIndex = 0;
          moveDir = pressDir;
          facingLeft = pressDir === -1;
        } else {
          // Key released during quick outro: go to normal outro
          movePhase = "outro";
          moveIndex = 0;
        }
      }
    } else if (movePhase === "quick-intro") {
      drawFrame("move", MOVE_QUICK_INTRO_FRAMES[moveIndex], facingLeft);
      moveIndex++;
      if (moveIndex >= MOVE_QUICK_INTRO_FRAMES.length) {
        movePhase = "loop";
        moveIndex = 0;
      }
    } else if (movePhase === "outro") {
      if (pressDir !== 0) {
        // Key pressed during outro: try to jump into quick-outro at matching frame
        const currentFrame = MOVE_OUTRO_FRAMES[moveIndex];
        const quickIdx = MOVE_QUICK_OUTRO_FRAMES.indexOf(currentFrame);
        if (quickIdx !== -1) {
          // Found matching frame — continue from here in quick outro
          movePhase = "quick-outro";
          moveIndex = quickIdx;
        } else {
          // Current frame not in quick outro — skip straight to new intro
          movePhase = "intro";
          moveIndex = 0;
          moveDir = pressDir;
          facingLeft = pressDir === -1;
        }
      } else {
        drawFrame("move", MOVE_OUTRO_FRAMES[moveIndex], facingLeft);
        moveIndex++;
        if (moveIndex >= MOVE_OUTRO_FRAMES.length) {
          movePhase = "none";
          moveDir = 0;
        }
      }
    } else if (pressDir !== 0) {
      // Direction changed while moving? Start quick outro
      if (
        (movePhase === "intro" || movePhase === "loop") &&
        pressDir !== moveDir
      ) {
        movePhase = "quick-outro";
        moveIndex = 0;
        drawFrame("move", MOVE_QUICK_OUTRO_FRAMES[moveIndex], facingLeft);
      } else {
        // Normal: start or continue in same direction
        if (movePhase === "none") {
          movePhase = "intro";
          moveIndex = 0;
          moveDir = pressDir;
          facingLeft = pressDir === -1;
        }

        if (movePhase === "intro") {
          drawFrame("move", MOVE_INTRO_FRAMES[moveIndex], facingLeft);
          moveIndex++;
          if (moveIndex >= MOVE_INTRO_FRAMES.length) {
            movePhase = "loop";
            moveIndex = 0;
          }
        } else if (movePhase === "loop") {
          drawFrame("move", MOVE_LOOP_FRAMES[moveIndex], facingLeft);
          moveIndex++;
          if (moveIndex >= MOVE_LOOP_FRAMES.length) moveIndex = 0;
        }
      }
    } else if (movePhase === "intro" || movePhase === "loop") {
      // Key released: start outro
      movePhase = "outro";
      moveIndex = 0;
      drawFrame("move", MOVE_OUTRO_FRAMES[moveIndex], facingLeft);
    } else if (isAirborne()) {
      // In the air: intro → loop
      if (vertPhase === "none" || vertPhase === "outro") {
        vertPhase = "intro";
        vertIndex = 0;
      }
      if (vertPhase === "intro") {
        drawFrame("move", VERT_INTRO_FRAMES[vertIndex], false);
        vertIndex++;
        if (vertIndex >= VERT_INTRO_FRAMES.length) {
          vertPhase = "loop";
          vertIndex = 0;
        }
      } else if (vertPhase === "loop") {
        drawFrame("move", VERT_LOOP_FRAMES[vertIndex], false);
        vertIndex++;
        if (vertIndex >= VERT_LOOP_FRAMES.length) vertIndex = 0;
      }
    } else if (vertPhase === "intro" || vertPhase === "loop") {
      // Landed: play outro
      vertPhase = "outro";
      vertIndex = 0;
      drawFrame("move", VERT_OUTRO_FRAMES[vertIndex], false);
    } else if (vertPhase === "outro") {
      drawFrame("move", VERT_OUTRO_FRAMES[vertIndex], false);
      vertIndex++;
      if (vertIndex >= VERT_OUTRO_FRAMES.length) {
        vertPhase = "none";
      }
    } else if (isTalking && !isMuted()) {
      // Talking while idle: use talk sheet (mouth overlay handles move+talk)
      drawFrame("talk", talkSegment[talkSegIndex], false);
    } else {
      // Idle: loop hover-in-place
      drawFrame("idle", IDLE_FRAMES[frame], false);
      frame = (frame + 1) % IDLE_FRAMES.length;
    }
  }

  let active = false;
  let rafId = null;

  function loop() {
    if (!active) {
      rafId = null;
      return;
    }
    update();
    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId) return;
    rafId = requestAnimationFrame(loop);
  }

  // Wait for first image to load before starting
  const checkReady = setInterval(() => {
    if (loaded.idle) {
      clearInterval(checkReady);
      if (active) startLoop();
    }
  }, 50);

  // Public API for talk state + visibility gating
  return {
    startTalking() {
      if (!isTalking) {
        isTalking = true;
        startTalkSegment();
      }
    },
    stopTalking() {
      if (!DEBUG_MOUTH) isTalking = false;
    },
    activate() {
      active = true;
      if (loaded.idle) startLoop();
    },
    deactivate() {
      active = false;
    },
  };
}
