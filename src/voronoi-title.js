import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import opentype from "opentype.js";
import { Delaunay } from "d3-delaunay";
import polygonClipping from "polygon-clipping";
import bebasWoff from "@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url";
import { stats, pageKeyForEvent, getCurrentPage } from "./stats.js";

// ── Path flattening ──────────────────────────────────────────────────────────

function cubicPt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] +
      3 * u * u * t * p1[0] +
      3 * u * t * t * p2[0] +
      t * t * t * p3[0],
    u * u * u * p0[1] +
      3 * u * u * t * p1[1] +
      3 * u * t * t * p2[1] +
      t * t * t * p3[1],
  ];
}

function quadPt(p0, p1, p2, t) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

function pathToContours(otPath, steps = 10) {
  const contours = [];
  let ring = [];
  let last = [0, 0];

  for (const cmd of otPath.commands) {
    switch (cmd.type) {
      case "M":
        if (ring.length > 2) contours.push(ring);
        ring = [[cmd.x, cmd.y]];
        last = [cmd.x, cmd.y];
        break;
      case "L":
        ring.push([cmd.x, cmd.y]);
        last = [cmd.x, cmd.y];
        break;
      case "C":
        for (let s = 1; s <= steps; s++)
          ring.push(
            cubicPt(
              last,
              [cmd.x1, cmd.y1],
              [cmd.x2, cmd.y2],
              [cmd.x, cmd.y],
              s / steps,
            ),
          );
        last = [cmd.x, cmd.y];
        break;
      case "Q":
        for (let s = 1; s <= steps; s++)
          ring.push(quadPt(last, [cmd.x1, cmd.y1], [cmd.x, cmd.y], s / steps));
        last = [cmd.x, cmd.y];
        break;
      case "Z":
        if (ring.length > 2) contours.push(ring);
        ring = [];
        last = [0, 0];
        break;
    }
  }
  if (ring.length > 2) contours.push(ring);
  return contours;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return a / 2;
}

function pointInRing(pt, ring) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function contoursToMultiPoly(contours) {
  const outers = contours.filter((c) => signedArea(c) > 0);
  const holes = contours.filter((c) => signedArea(c) <= 0);

  const polygons = outers.map((o) => [o]);

  holes.forEach((hole) => {
    const sample = hole[0];
    let best = null,
      bestArea = Infinity;
    polygons.forEach((poly) => {
      const outer = poly[0];
      const area = Math.abs(signedArea(outer));
      if (area < bestArea && pointInRing(sample, outer)) {
        best = poly;
        bestArea = area;
      }
    });
    if (best) best.push(hole);
  });

  return polygons;
}

function multiPolyToPath(mp) {
  let d = "";
  for (const poly of mp) {
    for (const ring of poly) {
      const pts =
        ring[ring.length - 1][0] === ring[0][0] &&
        ring[ring.length - 1][1] === ring[0][1]
          ? ring.slice(0, -1)
          : ring;
      if (pts.length < 2) continue;
      d += `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
      for (let i = 1; i < pts.length; i++)
        d += ` L${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
      d += " Z";
    }
  }
  return d;
}

// ── Title page: Voronoi + path intersection ─────────────────────────────────

export async function buildTitle(lenis) {
  const LINES = ["MY VISION FOR", "CREATIVE TECH", "AT HYPERQUAKE"];
  const NUM_SEEDS = 250;

  const font = await opentype.load(bebasWoff);
  console.log("font loaded", font);

  const SVG_W = 1000;
  const longestLine = LINES.reduce((a, b) =>
    font.getAdvanceWidth(a, 1) > font.getAdvanceWidth(b, 1) ? a : b,
  );
  const FONT_SIZE = (SVG_W * 0.98) / font.getAdvanceWidth(longestLine, 1);
  const LINE_H = FONT_SIZE * 0.85;
  const START_Y = FONT_SIZE * 0.95;
  const SVG_H = Math.ceil(
    START_Y + (LINES.length - 1) * LINE_H + FONT_SIZE * 0.15,
  );

  document
    .getElementById("title-svg")
    .setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);

  // Jittered grid seeds
  const seeds = [];
  const cols = Math.ceil(Math.sqrt((NUM_SEEDS * SVG_W) / SVG_H));
  const rows = Math.ceil(NUM_SEEDS / cols);
  const cellW = SVG_W / cols;
  const cellH = SVG_H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seeds.push([
        (c + 0.2 + Math.random() * 0.6) * cellW,
        (r + 0.2 + Math.random() * 0.6) * cellH,
      ]);
    }
  }
  const delaunay = Delaunay.from(seeds);
  const voronoi = delaunay.voronoi([0, 0, SVG_W, SVG_H]);

  // Build per-glyph MultiPolygons
  const glyphMPs = [];
  const glyphMeta = [];
  const TARGET_W = SVG_W * 0.98;
  LINES.forEach((line, i) => {
    const naturalW = font.getAdvanceWidth(line, FONT_SIZE);
    const charCount = line.replace(/ /g, "").length;
    const extraPerChar =
      charCount > 1 ? (TARGET_W - naturalW) / (charCount - 1) : 0;
    const y = START_Y + i * LINE_H;
    let cursor = (SVG_W - TARGET_W) / 2;
    let wordStart = 0;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      if (ch === " ") {
        wordStart = ci + 1;
        cursor += font.getAdvanceWidth(" ", FONT_SIZE) + extraPerChar;
        continue;
      }
      const word = line.slice(wordStart).split(" ")[0];
      const isHyperquake = word === "HYPERQUAKE";
      const otPath = font.getPath(ch, cursor, y, FONT_SIZE);
      const contours = pathToContours(otPath);
      if (contours.length > 0) {
        glyphMPs.push(contoursToMultiPoly(contours));
        glyphMeta.push({ isHyperquake, cursorX: cursor });
      }
      cursor += font.getAdvanceWidth(ch, FONT_SIZE) + extraPerChar;
    }
  });

  const fragsEl = document.getElementById("fragments");
  const frags = [];

  for (let gi = 0; gi < glyphMPs.length; gi++) {
    const glyphMP = glyphMPs[gi];
    for (let i = 0; i < seeds.length; i++) {
      const cell = voronoi.cellPolygon(i);
      if (!cell || cell.length < 3) continue;

      let result;
      try {
        result = polygonClipping.intersection([[cell]], glyphMP);
      } catch (e) {
        continue;
      }
      if (!result || result.length === 0) continue;

      for (const poly of result) {
        const d = multiPolyToPath([poly]);
        if (!d) continue;

        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const ring of poly) {
          for (const [x, y] of ring) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const bcx = (minX + maxX) / 2;
        const bcy = (minY + maxY) / 2;

        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("d", d);
        path.setAttribute("fill", "#2b2a27");
        path.setAttribute("stroke", "#2b2a27");
        path.setAttribute("stroke-width", "0.5");
        path.setAttribute("stroke-linejoin", "round");
        g.appendChild(path);
        fragsEl.appendChild(g);

        const angle = Math.random() * Math.PI * 2;
        const spread = 150 + Math.random() * 600;
        const rot = (Math.random() - 0.5) * 360;
        const delay = Math.random() * 0.15;
        const dur = 0.4 + Math.random() * 0.2;
        const nx = Math.cos(angle),
          ny = Math.sin(angle);

        frags.push({
          g,
          path,
          nx,
          ny,
          spread,
          rot,
          delay,
          dur,
          bcx,
          bcy,
          glyphIdx: gi,
          isHyperquake: glyphMeta[gi].isHyperquake,
          tremblePhase: Math.random() * Math.PI * 2,
        });

        g.setAttribute(
          "transform",
          `translate(${(nx * spread).toFixed(2)},${(ny * spread).toFixed(2)})`,
        );
        path.setAttribute(
          "transform",
          `rotate(${rot.toFixed(2)},${bcx.toFixed(2)},${bcy.toFixed(2)})`,
        );
        g.style.opacity = 0;
      }
    }
  }

  document.getElementById("loading").style.display = "none";

  // HYPERQUAKE gradient setup
  const hqFrags = frags.filter((f) => f.isHyperquake);
  const hqMinX = Math.min(...hqFrags.map((f) => f.bcx));
  const hqMaxX = Math.max(...hqFrags.map((f) => f.bcx));

  const svgEl = document.getElementById("title-svg");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <linearGradient id="hq-grad-a" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="0">
      <stop offset="0%"   stop-color="#5b4eff"/>
      <stop offset="100%" stop-color="#c840f0"/>
    </linearGradient>
    <linearGradient id="hq-grad-b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="0">
      <stop offset="0%"   stop-color="#ff3aaa" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ff3aaa" stop-opacity="0.5"/>
    </linearGradient>
  `;
  svgEl.insertBefore(defs, svgEl.firstChild);

  hqFrags.forEach((f) => {
    f.path.setAttribute("fill", "url(#hq-grad-a)");
    f.path.setAttribute("stroke", "url(#hq-grad-a)");
    const path2 = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path2.setAttribute("d", f.path.getAttribute("d"));
    path2.setAttribute("fill", "url(#hq-grad-b)");
    path2.style.mixBlendMode = "screen";
    path2.style.opacity = 0.9;
    path2.setAttribute("transform", f.path.getAttribute("transform"));
    f.g.appendChild(path2);
    f.path2 = path2;
  });

  // Animate gradient angles
  const gradA = defs.querySelector("#hq-grad-a");
  const gradB = defs.querySelector("#hq-grad-b");
  const hqCx = (hqMinX + hqMaxX) / 2,
    hqCy = SVG_H / 2,
    hqR = (hqMaxX - hqMinX) / 4;

  let titleVisible = true;
  ScrollTrigger.create({
    trigger: "#title-page",
    start: "top bottom",
    end: "bottom top",
    onEnter: () => { titleVisible = true; },
    onLeave: () => { titleVisible = false; },
    onEnterBack: () => { titleVisible = true; },
    onLeaveBack: () => { titleVisible = false; },
  });

  gsap.ticker.add((time) => {
    if (!titleVisible) return;
    const aA = time * 0.5;
    gradA.setAttribute("x1", (hqCx + Math.cos(aA) * hqR).toFixed(2));
    gradA.setAttribute("y1", (hqCy + Math.sin(aA) * hqR).toFixed(2));
    gradA.setAttribute("x2", (hqCx - Math.cos(aA) * hqR).toFixed(2));
    gradA.setAttribute("y2", (hqCy - Math.sin(aA) * hqR).toFixed(2));

    const aB = -time * 0.8;
    gradB.setAttribute("x1", (hqCx + Math.cos(aB) * hqR).toFixed(2));
    gradB.setAttribute("y1", (hqCy + Math.sin(aB) * hqR).toFixed(2));
    gradB.setAttribute("x2", (hqCx - Math.cos(aB) * hqR).toFixed(2));
    gradB.setAttribute("y2", (hqCy - Math.sin(aB) * hqR).toFixed(2));
  });

  // Assemble on load
  let assembleStarted = false; // true once runAssemble has been called at least once
  let assembleReady = false;
  let assembleTime = 0;
  const loadTweens = [];

  function setPathRotation(f, val) {
    const r = `rotate(${val.toFixed(2)},${f.bcx.toFixed(2)},${f.bcy.toFixed(2)})`;
    f.path.setAttribute("transform", r);
    if (f.path2) f.path2.setAttribute("transform", r);
  }

  function runAssemble() {
    assembleStarted = true;
    assembleReady = false;
    const tweens = [];
    frags.forEach((f) => {
      f.liveT = 1;
      f.g.setAttribute(
        "transform",
        `translate(${(f.nx * f.spread).toFixed(2)},${(f.ny * f.spread).toFixed(2)})`,
      );
      f.path.setAttribute(
        "transform",
        `rotate(${f.rot.toFixed(2)},${f.bcx.toFixed(2)},${f.bcy.toFixed(2)})`,
      );
      f.g.style.opacity = 0;
      const proxy = { t: 1 };
      const tween = gsap.to(proxy, {
        t: 0,
        duration: 2.5,
        ease: "expo.out",
        delay: 0.2 + f.delay * 4,
        onUpdate() {
          f.liveT = proxy.t;
          f.g.setAttribute(
            "transform",
            `translate(${(f.nx * f.spread * f.liveT).toFixed(2)},${(f.ny * f.spread * f.liveT).toFixed(2)})`,
          );
          setPathRotation(f, f.rot * f.liveT);
          f.g.style.opacity = 1 - f.liveT;
        },
        onComplete() {
          if (tweens.every((tw) => !tw.isActive())) {
            assembleReady = true;
            assembleTime = gsap.ticker.time;
            const hint = document.getElementById("scroll-hint");
            if (hint) hint.classList.add("visible");
          }
        },
      });
      tweens.push(tween);
    });
    loadTweens.length = 0;
    tweens.forEach((tw) => loadTweens.push(tw));
  }

  // Don't auto-assemble — caller will trigger via returned start()

  lenis.on("scroll", () => {
    if (!assembleStarted) return;
    const hint = document.getElementById("scroll-hint");
    if (hint && hint.classList.contains("visible")) {
      hint.classList.add("fade-out");
      hint.addEventListener("transitionend", () => hint.remove(), { once: true });
    }
    if (!assembleReady) {
      loadTweens.forEach((tw) => tw.kill());
      assembleReady = true;
      assembleTime = gsap.ticker.time;
    }
  });

  // Group fragments by glyph index
  const numGlyphs = glyphMPs.length;
  const byGlyph = Array.from({ length: numGlyphs }, () => []);
  frags.forEach((f) => byGlyph[f.glyphIdx].push(f));

  const glyphDur = 0.2;
  const thresholds = Array.from(
    { length: numGlyphs },
    () => 0.05 + Math.random() * 0.5,
  );

  let scrollProgress = 0;

  ScrollTrigger.create({
    trigger: "#title-page",
    start: "top top",
    end: "bottom top",
    scrub: true,
    onUpdate(self) {
      scrollProgress = self.progress;
      thresholds.forEach((thresh, idx) => {
        const target = Math.max(
          0,
          Math.min(1, (scrollProgress - thresh) / glyphDur),
        );
        byGlyph[idx].forEach((f) => {
          f.targetT = target;
        });
      });
    },
  });

  // Mouse repulsion — velocity-driven with smoothing
  const mouse = { svgX: -99999, svgY: -99999, vx: 0, vy: 0 };
  let prevMouse = null;
  const VEL_SMOOTH = 0.1;
  window.addEventListener("mousemove", (e) => {
    if (!assembleReady) {
      prevMouse = null;
      return;
    }
    const rect = svgEl.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    const now = performance.now();
    const sx = (e.clientX - rect.left) * scaleX;
    const sy = (e.clientY - rect.top) * scaleY;
    if (!prevMouse) {
      prevMouse = { x: sx, y: sy, time: now };
      mouse.svgX = sx;
      mouse.svgY = sy;
      return;
    }
    const dt = Math.max(now - prevMouse.time, 1) / 1000;
    const rawVx = (sx - prevMouse.x) / dt;
    const rawVy = (sy - prevMouse.y) / dt;
    mouse.vx += (rawVx - mouse.vx) * VEL_SMOOTH;
    mouse.vy += (rawVy - mouse.vy) * VEL_SMOOTH;
    mouse.svgX = sx;
    mouse.svgY = sy;
    prevMouse = { x: sx, y: sy, time: now };

    // Track mouse move duration (only if mouse is over the title page)
    if (pageKeyForEvent(e) === "title") {
      if (mouseDown) {
        stats.title.mouseMovedClicked += dt;
      } else {
        stats.title.mouseMovedUnclicked += dt;
      }
    }
  });

  frags.forEach((f) => {
    f.repelX = 0;
    f.repelY = 0;
    f.targetT = 0;
    f.liveT = 1; // start fully scattered (invisible) until runAssemble is called
    f.trembleT = f.tremblePhase || 0;
  });
  const REPEL_STRENGTH = 5000;
  const REPEL_EASE = 0.06;

  // Click shockwave — continuous while mouse is held down
  const CLICK_STRENGTH = 120;
  const CLICK_RADIUS = 800;
  let mouseDown = false;

  svgEl.addEventListener("mousedown", () => { mouseDown = true; stats.title.clickCount++; });
  window.addEventListener("mouseup", () => { mouseDown = false; });

  // HYPERQUAKE tremble — calm drift with sharp bursts sweeping L→R
  const TREMBLE_CALM = 0.0;
  const TREMBLE_BURST = 2.0;
  const TREMBLE_SPEED = 0.0;
  const BURST_SPEED = 40;
  const PULSE_PERIOD = 6;
  const BURST_FRACTION = 0.2;
  const SWEEP_DELAY = 0.1;

  // Precompute per-fragment sweep offset
  hqFrags.forEach((f) => {
    f.sweepT = hqMaxX > hqMinX ? (f.bcx - hqMinX) / (hqMaxX - hqMinX) : 0;
  });

  let lastTickTime = null;
  let lastPulseCycle = -1;
  gsap.ticker.add((time) => {
    if (!assembleReady || !titleVisible) return;
    const dt = lastTickTime !== null ? time - lastTickTime : 0;
    lastTickTime = time;

    // Track jitter cycles
    const elapsed = time - assembleTime;
    const currentCycle = Math.floor(elapsed / PULSE_PERIOD);
    if (currentCycle > lastPulseCycle) {
      if (lastPulseCycle >= 0 && getCurrentPage() === "title") stats.title.jitterCount++;
      lastPulseCycle = currentCycle;
    }

    // Track mouse held duration
    if (mouseDown) {
      stats.title.mouseClickedDuration += dt;
    }

    const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);
    const velScale = Math.min(speed / 500, 1);
    mouse.vx *= 0.9;
    mouse.vy *= 0.9;

    const halfBurst = BURST_FRACTION / 2;

    frags.forEach((f) => {
      const diff = f.targetT - f.liveT;
      if (Math.abs(diff) < 0.001) {
        f.liveT = f.targetT;
      } else {
        f.liveT += diff * 0.12;
      }

      const scrolling = scrollProgress > 0.05;
      if (!scrolling) {
        const dx = f.bcx - mouse.svgX;
        const dy = f.bcy - mouse.svgY;
        const distSq = Math.max(dx * dx + dy * dy, 15000);
        const force = (velScale * REPEL_STRENGTH) / distSq;
        let targetRepelX = dx * force;
        let targetRepelY = dy * force;

        // Continuous click shockwave while mouse is held
        if (mouseDown) {
          const cdx = f.bcx - mouse.svgX;
          const cdy = f.bcy - mouse.svgY;
          const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
          const falloff = Math.max(0, 1 - cdist / CLICK_RADIUS);
          const impulse = CLICK_STRENGTH * falloff;
          if (cdist > 0.1) {
            targetRepelX += (cdx / cdist) * impulse;
            targetRepelY += (cdy / cdist) * impulse;
          }
        }

        f.repelX += (targetRepelX - f.repelX) * REPEL_EASE;
        f.repelY += (targetRepelY - f.repelY) * REPEL_EASE;
      } else {
        f.repelX += (0 - f.repelX) * REPEL_EASE;
        f.repelY += (0 - f.repelY) * REPEL_EASE;
      }

      let tx = f.nx * f.spread * f.liveT + f.repelX;
      let ty = f.ny * f.spread * f.liveT + f.repelY;

      if (f.isHyperquake && !scrolling && f.liveT < 0.5) {
        const sweepOffset = (f.sweepT || 0) * SWEEP_DELAY * 10;
        const elapsed = time - assembleTime;
        const fCycle =
          ((((elapsed - sweepOffset) % PULSE_PERIOD) + PULSE_PERIOD) %
            PULSE_PERIOD) /
          PULSE_PERIOD;
        const fDistFromPeak = Math.abs(fCycle - halfBurst) / halfBurst;
        const fBurstRaw = Math.max(0, 1 - fDistFromPeak);
        const fBurst = fBurstRaw * fBurstRaw * (3 - 2 * fBurstRaw);
        const fAmp = TREMBLE_CALM + TREMBLE_BURST * fBurst;
        const fFreq = TREMBLE_SPEED + (BURST_SPEED - TREMBLE_SPEED) * fBurst;

        f.trembleT += fFreq * dt;
        tx += Math.sin(f.trembleT) * fAmp * (1 - f.liveT * 2);
        ty += Math.cos(f.trembleT * 1.3) * fAmp * (1 - f.liveT * 2);
      }

      f.g.setAttribute(
        "transform",
        `translate(${tx.toFixed(2)},${ty.toFixed(2)})`,
      );
      setPathRotation(f, f.rot * f.liveT);
      f.g.style.opacity = Math.max(0, 1 - f.liveT * 2);
    });

  });

  function replay() {
    assembleReady = false;
    loadTweens.forEach((tw) => tw.kill());
    runAssemble();
  }

  return { start: runAssemble, replay };
}
