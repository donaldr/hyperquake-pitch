import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { stats, pageKeyForEvent } from "./stats.js";

// ── Constants ────────────────────────────────────────────────────────────────
const BG_COLOR = 0xeeeadf;
const HOLD = 0; // seconds before animation starts
const ZOOM_HOLD = 1.0; // seconds to hold zoom/pivot after loop reset
const HELD_ZOOM_HOLD = 0.3; // seconds to hold zoom/pivot after loop reset in fast mode
const SPEED = 2.88; // progress per second (was 0.012 per frame × 60fps)
const ACCEL = 0.25; // exponent for acceleration as pieces accumulate (1 = linear, 2 = quadratic)
const GROW = 6;
const FILL = 0.5; // fraction of container height the shape should fill
const ZOOM_LERP = 0.01;
const Y_LERP = 0.01;
const FOV = 46;
const BASE_GREY = 0.15; // base grey value — darker for contrast against light bg
const GREY_SPREAD = 0.12; // 0 = all same grey, higher = more variation
const MOUSE_ROTATE = 1.8; // max radians of rotation from mouse X position
const IDLE_ROTATE_SPEED = 0.15; // radians per second when mouse is idle
const SPIN_BURST_SPEED = 1.0; // radians per second when mouse is held
const HELD_SPEED = 8.0; // build speed when mouse is held
const HELD_ACCEL = 0.5; // acceleration exponent when held
const HELD_GROW = 3; // grow overlap when held
const HELD_LERP_MUL = 10; // lerp multiplier when held
const HELD_BLEND_RATE = 3; // how fast to blend towards held/unheld values (per second)
const CLICK_THRESHOLD = 0.2; // max seconds to count as a quick click
const CLICK_BURST = 0.6; // seconds to hold the effect after a quick click
const DEPTH = 1; // subdivision depth (1 = 8 pieces, 2 = 64, 3 = 512)
const FADE_DURATION = 0.8; // seconds to fade greys to uniform before restart
const PAUSE_BEFORE_RESTART = 0.0; // seconds to hold after build completes
const SCALE_X = 1.5; // horizontal scale of the shape
const CENTER_ON_VISIBLE = true; // true = center on all visible pieces, false = only settled
const LERP_RAMP_REMAINING = 7; // start ramping lerps when N - X pieces have settled
const LERP_RAMP_MAX = 6; // max lerp multiplier at full build

const ORDER = [0, 6, 4, 1, 7, 5, 2, 3];
const ROOT = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [1, 1, 1],
];
const CTR = [0.75, 0.5, 0.25];

// ── Geometry helpers ─────────────────────────────────────────────────────────
function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function subdivide([A, B, C, D]) {
  const mAB = mid(A, B),
    mBC = mid(B, C),
    mCD = mid(C, D);
  const mAC = mid(A, C),
    mBD = mid(B, D),
    mAD = mid(A, D);
  return [
    [A, mAB, mAC, mAD],
    [mAB, B, mBC, mBD],
    [mAC, mBC, C, mCD],
    [mAD, mBD, mCD, D],
    [mAB, mAC, mBC, mBD],
    [mAC, mAD, mBD, mCD],
    [mAB, mAC, mAD, mBD],
    [mAC, mBC, mBD, mCD],
  ];
}

function buildSequence(depth) {
  let sequence = [ROOT];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const tet of sequence) {
      const subs = subdivide(tet);
      for (const idx of ORDER) next.push(subs[idx]);
    }
    sequence = next;
  }
  return sequence;
}

function makeGeo(rawVerts, alignQ) {
  const V = rawVerts.map(
    (v) => new THREE.Vector3(v[0] - CTR[0], v[1] - CTR[1], v[2] - CTR[2]),
  );
  const [A, B, C, D] = V;
  const pos = [],
    flatNrm = [],
    bentNrm = [],
    uvs = [];
  const center = new THREE.Vector3()
    .add(A)
    .add(B)
    .add(C)
    .add(D)
    .multiplyScalar(0.25);
  function face(p, q, r) {
    let n = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(q, p),
        new THREE.Vector3().subVectors(r, p),
      )
      .normalize();
    // Ensure normal points outward from tetrahedron center
    const faceCenter = new THREE.Vector3().add(p).add(q).add(r).divideScalar(3);
    let verts = [p, q, r];
    if (n.dot(new THREE.Vector3().subVectors(faceCenter, center)) < 0) {
      n.negate();
      verts = [p, r, q]; // swap winding order
    }
    const faceUVs = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ];
    for (let vi = 0; vi < 3; vi++) {
      pos.push(verts[vi].x, verts[vi].y, verts[vi].z);
      flatNrm.push(n.x, n.y, n.z);
      const outward = new THREE.Vector3()
        .subVectors(verts[vi], center)
        .normalize();
      const bent = new THREE.Vector3().copy(n).lerp(outward, 0.15).normalize();
      bentNrm.push(bent.x, bent.y, bent.z);
      uvs.push(faceUVs[vi][0], faceUVs[vi][1]);
    }
  }
  face(A, B, C);
  face(A, B, D);
  face(B, C, D);
  face(A, C, D);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(bentNrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return {
    geo: g,
    flatNormals: new Float32Array(flatNrm),
    bentNormals: new Float32Array(bentNrm),
  };
}

function ease(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ── Main init ────────────────────────────────────────────────────────────────
export function initShapeBuilder() {
  const page = document.getElementById("page-04");
  if (!page) return;
  const container = page.querySelector(".shape-builder-wrap");
  if (!container) return;

  const w = container.clientWidth || 400;
  const h = container.clientHeight || 400;

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  renderer.setClearColor(BG_COLOR, 0); // transparent so page bg shows through
  container.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();

  // Camera
  const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.01, 200);
  camera.lookAt(0, 0, 0);

  /* // Lights — warm sun from above-right-front, cool shade from below-left-front
  const sunLight = new THREE.DirectionalLight(0xffe0b0, 0.8);
  sunLight.position.set(2, 3, 3);
  scene.add(sunLight);
  const shadeLight = new THREE.DirectionalLight(0x80a0c0, 0.4);
  shadeLight.position.set(-2, -2, 3);
  scene.add(shadeLight);
  scene.add(new THREE.AmbientLight(0xd0c8c0, 0.5)); */

  // Procedural environment map — layered for visible variation
  const envSize = 1024;
  const envCanvas = document.createElement("canvas");
  envCanvas.width = envSize;
  envCanvas.height = envSize;
  const ctx = envCanvas.getContext("2d");

  // Base: dark-to-mid vertical gradient (ground to sky)
  const base = ctx.createLinearGradient(0, envSize, 0, 0);
  base.addColorStop(0.0, "#1a1a25");
  base.addColorStop(0.3, "#2a3344");
  base.addColorStop(0.5, "#445566");
  base.addColorStop(0.7, "#556677");
  base.addColorStop(1.0, "#667788");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, envSize, envSize);

  // Many bright hotspots at varied sizes
  const hotspots = [];
  for (let i = 0; i < 120; i++) {
    const a1 = i * 2.399 + 0.5,
      a2 = i * 1.731 + 1.3;
    hotspots.push({
      x: Math.sin(a1) * 0.5 + 0.5,
      y: Math.cos(a2) * 0.5 + 0.5,
      r: 0.05 + (Math.sin(i * 3.7) * 0.5 + 0.5) * 0.1,
      bright: 0.4 + (Math.cos(i * 2.3) * 0.5 + 0.5) * 0.6,
      hue: (i * 47 + 10) % 360,
    });
  }
  ctx.globalCompositeOperation = "lighter";
  for (const s of hotspots) {
    const g = ctx.createRadialGradient(
      s.x * envSize,
      s.y * envSize,
      0,
      s.x * envSize,
      s.y * envSize,
      s.r * envSize,
    );
    const l = Math.round(70 + s.bright * 30);
    g.addColorStop(0, `hsla(${s.hue}, 20%, ${l}%, 0.15)`);
    g.addColorStop(1, `hsla(${s.hue}, 20%, ${l}%, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, envSize, envSize);
  }
  ctx.globalCompositeOperation = "source-over";

  // Warm/cool horizontal bands
  ctx.globalCompositeOperation = "overlay";
  const bands = ctx.createLinearGradient(0, 0, envSize, 0);
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const hue = (t * 2880 + 30) % 360;
    bands.addColorStop(t, `hsla(${hue}, 40%, 55%, 0.35)`);
  }
  ctx.fillStyle = bands;
  ctx.fillRect(0, 0, envSize, envSize);

  // Vertical bands too
  const vBands = ctx.createLinearGradient(0, 0, 0, envSize);
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const hue = (t * 2160 + 180) % 360;
    vBands.addColorStop(t, `hsla(${hue}, 30%, 60%, 0.25)`);
  }
  ctx.fillStyle = vBands;
  ctx.fillRect(0, 0, envSize, envSize);

  // Many diagonal streaks (golden ratio distribution to avoid center clustering)
  ctx.globalCompositeOperation = "soft-light";
  for (let i = 0; i < 20; i++) {
    const x1 = (i * 0.618033988 + 0.1) % 1;
    const y1 = (i * 0.381966011 + 0.3) % 1;
    const x2 = (i * 0.518033988 + 0.7) % 1;
    const y2 = (i * 0.281966011 + 0.9) % 1;
    const sg = ctx.createLinearGradient(
      x1 * envSize,
      y1 * envSize,
      x2 * envSize,
      y2 * envSize,
    );
    const hue = (i * 23) % 360;
    const alpha = 0.3 + Math.sin(i * 1.1) * 0.1;
    sg.addColorStop(0, "transparent");
    sg.addColorStop(0.3, `hsla(${hue}, 35%, 65%, ${alpha})`);
    sg.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 40%, 75%, ${alpha + 0.1})`);
    sg.addColorStop(0.7, `hsla(${hue}, 35%, 65%, ${alpha})`);
    sg.addColorStop(1, "transparent");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, envSize, envSize);
  }

  const rawEnvTexture = new THREE.CanvasTexture(envCanvas);
  rawEnvTexture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromEquirectangular(rawEnvTexture).texture;
  pmrem.dispose();
  scene.environment = envTexture;

  // Geometry — prebuild both depths
  const alignQ = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(1, 1, 1).normalize(),
    new THREE.Vector3(0, 1, 0),
  );

  // Outer group for Y-axis rotation, inner pivot for alignment
  const rotateGroup = new THREE.Group();
  rotateGroup.scale.set(SCALE_X, 1, SCALE_X);
  scene.add(rotateGroup);
  const pivot = new THREE.Group();
  pivot.quaternion.copy(alignQ);
  rotateGroup.add(pivot);

  function pieceColor(i) {
    const t = (i * 0.618033988749895) % 1;
    const v = Math.max(0, Math.min(1, BASE_GREY + (t - 0.5) * 2 * GREY_SPREAD));
    return new THREE.Color(v, v, v);
  }

  function buildDepthData(depth) {
    const seq = buildSequence(depth);
    const gd = seq.map((verts) => makeGeo(verts, alignQ));
    const ms = seq.map((_v, i) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: pieceColor(i),
        metalness: 0.1,
        roughness: 0.15,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        reflectivity: 0.7,
        specularIntensity: 1.5,
        envMapIntensity: 3.0,
        envMap: envTexture,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(gd[i].geo, mat);
      mesh.visible = false;
      pivot.add(mesh);
      return mesh;
    });
    const cents = seq.map((verts) => {
      const c = verts
        .reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
        .map((x) => x / 4);
      return new THREE.Vector3(
        c[0] - CTR[0],
        c[1] - CTR[1],
        c[2] - CTR[2],
      ).applyQuaternion(alignQ);
    });
    const rA = Math.max(...cents.map((c) => c.length()));
    const oc = ms.map((m) => m.material.color.clone());
    return {
      sequence: seq,
      geoData: gd,
      meshes: ms,
      centroids: cents,
      rAll: rA,
      originalColors: oc,
      N: seq.length,
      depth,
    };
  }

  const depthData = {
    1: buildDepthData(1),
    2: buildDepthData(2),
  };

  // Active depth state — start with depth 1, hide depth 2
  let cur = depthData[DEPTH];
  let currentDepth = DEPTH;

  // Accessors that reference cur
  function setNormalBend(blend) {
    for (let i = 0; i < cur.N; i++) {
      const nrmAttr = cur.meshes[i].geometry.getAttribute("normal");
      const flat = cur.geoData[i].flatNormals;
      const bent = cur.geoData[i].bentNormals;
      for (let j = 0; j < flat.length; j++) {
        nrmAttr.array[j] = flat[j] + (bent[j] - flat[j]) * blend;
      }
      nrmAttr.needsUpdate = true;
    }
  }

  function zoomToFit(lerp) {
    const box = new THREE.Box3();
    scene.updateMatrixWorld(true);
    for (let i = 0; i < cur.N; i++) {
      if (CENTER_ON_VISIBLE ? rev[i] > 0 : rev[i] >= 1) {
        box.union(new THREE.Box3().setFromObject(cur.meshes[i]));
      }
    }
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const bmin = box.min,
      bmax = box.max;
    let sMinY = Infinity,
      sMaxY = -Infinity;
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++) {
          const p = new THREE.Vector3(
            xi ? bmax.x : bmin.x,
            yi ? bmax.y : bmin.y,
            zi ? bmax.z : bmin.z,
          );
          p.project(camera);
          sMinY = Math.min(sMinY, p.y);
          sMaxY = Math.max(sMaxY, p.y);
        }
    const screenH = sMaxY - sMinY;
    if (screenH > 0) {
      const targetZ = camera.position.z * (screenH / (FILL * 2));
      camera.position.z += (targetZ - camera.position.z) * lerp;
    }
    camera.lookAt(0, 0, 0);
  }

  // Mouse rotation state
  let mouseX = 0.5;
  let idleAngle = 0;
  let lastTime = performance.now();

  let lastMoveTime04 = 0;
  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX / window.innerWidth;
    const now = performance.now();
    if (lastMoveTime04 > 0 && pageKeyForEvent(e) === "page04") {
      stats.page04.mouseMovingDuration += (now - lastMoveTime04) / 1000;
    }
    lastMoveTime04 = now;
  });

  const uniformColor = pieceColor(0);

  // Animation state
  let elapsed = 0,
    progress = 0;
  let rev = new Float32Array(cur.N);
  let active = false;
  let phase = "building";
  let phaseTime = 0;
  let zoomHoldTime = 0;
  let normalBend = 0;

  function switchDepth(depth) {
    if (depth === currentDepth) return;
    // Hide all meshes of current depth
    cur.meshes.forEach((m) => (m.visible = false));
    currentDepth = depth;
    cur = depthData[depth];
    rev = new Float32Array(cur.N);
  }

  function reset() {
    elapsed = 0;
    progress = 0;
    rev = new Float32Array(cur.N);
    rev[0] = 1;
    phase = "building";
    phaseTime = 0;
    pivot.position.set(
      -cur.centroids[0].x,
      -cur.centroids[0].y,
      -cur.centroids[0].z,
    );
    cur.meshes.forEach((m, i) => {
      m.visible = false;
      m.scale.setScalar(1);
      m.position.set(0, 0, 0);
      m.material.color.copy(cur.originalColors[i]);
    });
    cur.meshes[0].visible = true;
    normalBend = 0;
    setNormalBend(0);
  }
  function loopReset() {
    if (pendingDepth !== null) {
      switchDepth(pendingDepth);
      pendingDepth = null;
    }
    camera.position.z /= Math.pow(2, currentDepth);
    reset();
    zoomHoldTime = spinHeld ? HELD_ZOOM_HOLD : ZOOM_HOLD;
  }
  // Initial setup
  camera.position.set(0, 0, 2);
  reset();
  for (let i = 0; i < 10; i++) zoomToFit(1);

  function render() {
    if (!active) return;
    requestAnimationFrame(render);

    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Blend towards held/unheld values
    const blendTarget = spinHeld ? 1 : 0;
    heldBlend += (blendTarget - heldBlend) * Math.min(1, HELD_BLEND_RATE * dt);

    const curSpeed = SPEED + (HELD_SPEED - SPEED) * heldBlend;
    const curAccel = ACCEL + (HELD_ACCEL - ACCEL) * heldBlend;
    const curGrow = GROW + (HELD_GROW - GROW) * heldBlend;

    if (phase === "building") {
      elapsed += dt;
      if (elapsed > HOLD) {
        const act = Math.max(1, Math.floor(progress));
        progress = Math.min(
          cur.N + curGrow,
          progress + Math.pow(act, curAccel) * curSpeed * dt,
        );
      }

      // Ramp normal bend in during build
      normalBend = Math.min(1, normalBend + dt / FADE_DURATION);

      rev[0] = 1;
      for (let i = 1; i < cur.N; i++)
        rev[i] = Math.min(1, Math.max(0, (progress - i) / curGrow));

      for (let i = 0; i < cur.N; i++) {
        if (rev[i] <= 0) {
          cur.meshes[i].visible = false;
          continue;
        }
        cur.meshes[i].visible = true;
        const ep = ease(rev[i]);
        cur.meshes[i].scale.setScalar(0.001 + ep * 0.999);
        cur.meshes[i].position.copy(
          cur.centroids[i]
            .clone()
            .normalize()
            .multiplyScalar((1 - ep) * cur.rAll * 1.5),
        );
      }

      // Check if all pieces are settled
      if (rev[cur.N - 1] >= 1) {
        if (currentDepth === 1) stats.page04.smallPyramidsBuilt++;
        else stats.page04.largePyramidsBuilt++;
        phase = "pausing";
        phaseTime = 0;
      }
    } else if (phase === "pausing") {
      phaseTime += dt;
      if (phaseTime >= PAUSE_BEFORE_RESTART) {
        phase = "fading";
        phaseTime = 0;
      }
    } else if (phase === "fading") {
      phaseTime += dt;
      const t = Math.min(1, phaseTime / FADE_DURATION);

      // Fade normals back to flat
      normalBend = 1 - t;
      for (let i = 0; i < cur.N; i++) {
        cur.meshes[i].material.color
          .copy(cur.originalColors[i])
          .lerp(uniformColor, t);
      }
      if (t >= 1) {
        loopReset();
      }
    }

    // Center on visible/settled pieces
    const visCenter = new THREE.Vector3();
    let visCount = 0;
    for (let i = 0; i < cur.N; i++) {
      if (CENTER_ON_VISIBLE ? rev[i] > 0 : rev[i] >= 1) {
        visCenter.add(cur.centroids[i]);
        visCount++;
      }
    }
    if (visCount > 0) visCenter.divideScalar(visCount);

    // Ramp lerps as we approach full build
    let settledCount = 0;
    for (let i = 0; i < cur.N; i++) if (rev[i] >= 1) settledCount++;
    const rampStart = cur.N - LERP_RAMP_REMAINING;
    const rampT =
      settledCount >= rampStart
        ? (settledCount - rampStart) / LERP_RAMP_REMAINING
        : 0;
    const baseLerpMul = 1 + rampT * (LERP_RAMP_MAX - 1);
    const lerpMul = baseLerpMul + (HELD_LERP_MUL - baseLerpMul) * heldBlend;

    // Hold pivot and zoom briefly after loop reset
    if (zoomHoldTime > 0) {
      zoomHoldTime -= dt;
    } else {
      const yLerp = 1 - Math.pow(Math.max(0, 1 - Y_LERP * lerpMul), dt * 60);
      pivot.position.x += (-visCenter.x - pivot.position.x) * yLerp;
      pivot.position.y += (-visCenter.y - pivot.position.y) * yLerp;
      pivot.position.z += (-visCenter.z - pivot.position.z) * yLerp;

      const zLerp =
        1 - Math.pow(Math.max(0, 1 - ZOOM_LERP * baseLerpMul), dt * 60);
      zoomToFit(zLerp);
    }

    const spinSpeed =
      IDLE_ROTATE_SPEED + (SPIN_BURST_SPEED - IDLE_ROTATE_SPEED) * heldBlend;
    idleAngle += spinSpeed * dt;
    const mouseOffset = (mouseX - 0.5) * 2 * MOUSE_ROTATE;
    const targetRot = idleAngle + mouseOffset;
    const rotLerp = 1 - Math.pow(1 - 0.08, dt * 60);
    rotateGroup.rotation.y += (targetRot - rotateGroup.rotation.y) * rotLerp;

    setNormalBend(normalBend);
    renderer.render(scene, camera);
  }

  // Mousedown rapid spin + depth switch
  let spinHeld = false;
  let heldBlend = 0; // 0 = normal, 1 = fully held
  let pendingDepth = null;
  let mouseDownTime = 0;
  let clickBurstTimer = null;

  page.addEventListener("mousedown", () => {
    clearTimeout(clickBurstTimer);
    spinHeld = true;
    mouseDownTime = performance.now();
    stats.page04.clickCount++;
    if (currentDepth !== 2) pendingDepth = 2;
  });
  window.addEventListener("mouseup", () => {
    if (!spinHeld) return;
    const elapsed = (performance.now() - mouseDownTime) / 1000;
    stats.page04.mousePressedDuration += elapsed;

    if (elapsed < CLICK_THRESHOLD) {
      // Quick click: snap blend to 1, hold for CLICK_BURST, then release
      heldBlend = 1;
      clickBurstTimer = setTimeout(() => {
        spinHeld = false;
        pendingDepth = null;
        if (currentDepth !== DEPTH) pendingDepth = DEPTH;
      }, CLICK_BURST * 1000);
    } else {
      spinHeld = false;
      pendingDepth = null;
      if (currentDepth !== DEPTH) pendingDepth = DEPTH;
    }
  });

  // ScrollTrigger: activate when page is visible
  ScrollTrigger.create({
    trigger: page,
    start: "top 80%",
    end: "bottom 20%",
    onEnter: () => {
      active = true;
      reset();
      cur.meshes[0].visible = true;
      render();
    },
    onLeave: () => {
      active = false;
    },
    onEnterBack: () => {
      active = true;
      reset();
      cur.meshes[0].visible = true;
      render();
    },
    onLeaveBack: () => {
      active = false;
    },
  });

  // Resize
  const onResize = () => {
    const nw = container.clientWidth;
    const nh = container.clientHeight;
    renderer.setSize(nw, nh);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);
}
