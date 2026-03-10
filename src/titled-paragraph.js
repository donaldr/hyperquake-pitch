import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const DIRECTIONS = [
  { x: 0, y: "100%" },
  { x: "100%", y: 0 },
  { x: 0, y: "-100%" },
  { x: "-100%", y: 0 },
];

const BAND_FRACS = [0.1667, 0.5, 0.8333];

function buildTitle(para) {
  const titleEl = para.querySelector(".tp-title");
  const text = titleEl.textContent;
  titleEl.textContent = "";

  text.split(/\s+/).forEach((word, i, arr) => {
    const mask = document.createElement("span");
    mask.className = "tp-word-mask";
    const span = document.createElement("span");
    span.className = "tp-word";
    span.textContent = word;
    mask.appendChild(span);
    titleEl.appendChild(mask);
    if (i < arr.length - 1) titleEl.appendChild(document.createTextNode(" "));
  });

  const underline = document.createElement("span");
  underline.className = "tp-underline";
  titleEl.appendChild(underline);
}


function calcCallout(page, circleEl, para, i) {
  const pageRect = page.getBoundingClientRect();
  const circleRect = circleEl.getBoundingClientRect();
  const cx = circleRect.left + circleRect.width / 2 - pageRect.left;
  const cy = circleRect.top + circleRect.height / 2 - pageRect.top;
  const r = circleRect.width / 2;

  const titleEl = para.querySelector(".tp-title");
  const titleRect = titleEl.getBoundingClientRect();
  const paraRect = para.getBoundingClientRect();
  const sx = Math.min(titleRect.left, paraRect.left) - pageRect.left - 20;
  const sy = titleRect.bottom - pageRect.top - 1;

  const edgeX = cx + r + 20;
  const edgeY = sy;

  const bandFrac = BAND_FRACS[i];
  const dx = edgeX - cx;
  const dy = edgeY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const bandRadius = bandFrac * r;
  const targetX = cx + (dx / dist) * bandRadius;
  const targetY = cy + (dy / dist) * bandRadius;

  return { sx, sy, edgeX, edgeY, targetX, targetY };
}

function buildCallouts(page) {
  const circleEl = page.querySelector(".concentric-circles");
  if (!circleEl) return;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("callout-svg");
  page.appendChild(svg);

  const paras = Array.from(page.querySelectorAll(".titled-para"));

  paras.forEach((para, i) => {
    if (i >= BAND_FRACS.length) return;

    const pts = calcCallout(page, circleEl, para, i);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", `${pts.sx},${pts.sy} ${pts.edgeX},${pts.edgeY} ${pts.targetX},${pts.targetY}`);
    line.classList.add("callout-line");
    svg.appendChild(line);

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", pts.targetX);
    dot.setAttribute("cy", pts.targetY);
    dot.setAttribute("r", 3);
    dot.classList.add("callout-dot");
    svg.appendChild(dot);
    gsap.set(dot, { autoAlpha: 0 });

    const length = line.getTotalLength();
    gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });

    para._calloutLine = line;
    para._calloutDot = dot;
    para._calloutLength = length;
  });

  page._calloutCircleEl = circleEl;
  page._calloutSvg = svg;
}

function updateCallouts(page) {
  const circleEl = page._calloutCircleEl;
  if (!circleEl) return;

  const paras = Array.from(page.querySelectorAll(".titled-para"));
  paras.forEach((para, i) => {
    if (i >= BAND_FRACS.length || !para._calloutLine) return;

    const pts = calcCallout(page, circleEl, para, i);

    para._calloutLine.setAttribute("points", `${pts.sx},${pts.sy} ${pts.edgeX},${pts.edgeY} ${pts.targetX},${pts.targetY}`);
    para._calloutDot.setAttribute("cx", pts.targetX);
    para._calloutDot.setAttribute("cy", pts.targetY);

    const length = para._calloutLine.getTotalLength();
    para._calloutLength = length;
    gsap.set(para._calloutLine, { strokeDasharray: length });
  });
}

function titleIn(para, delay) {
  const words = para.querySelectorAll(".tp-word");
  const underline = para.querySelector(".tp-underline");

  words.forEach((word, i) => {
    gsap.killTweensOf(word);
    gsap.to(word, {
      x: 0,
      y: 0,
      duration: 0.6,
      ease: "power3.out",
      delay: delay + i * 0.08,
    });
  });

  gsap.killTweensOf(underline);
  gsap.to(underline, {
    scaleX: 1,
    duration: 0.5,
    ease: "power2.out",
    delay: delay + words.length * 0.08,
  });
}

function titleOut(para, delay) {
  const words = para.querySelectorAll(".tp-word");
  const underline = para.querySelector(".tp-underline");

  words.forEach((word, i) => {
    const dir = DIRECTIONS[i % DIRECTIONS.length];
    gsap.killTweensOf(word);
    gsap.to(word, {
      x: dir.x,
      y: dir.y,
      duration: 0.4,
      ease: "power3.in",
      delay: delay + i * 0.05,
    });
  });

  gsap.killTweensOf(underline);
  gsap.to(underline, {
    scaleX: 0,
    duration: 0.3,
    ease: "power2.in",
    delay: delay,
  });
}

function animateParaIn(para, delay) {
  gsap.killTweensOf(para);
  gsap.to(para, {
    autoAlpha: 1,
    x: 0,
    duration: 0.5,
    ease: "power2.out",
    delay: delay,
  });
  titleIn(para, delay + 0.1);

  if (para._calloutLine) {
    gsap.killTweensOf(para._calloutLine);
    gsap.to(para._calloutLine, {
      strokeDashoffset: 0,
      duration: 0.6,
      ease: "power2.out",
      delay: delay + 0.1,
    });
    gsap.killTweensOf(para._calloutDot);
    gsap.to(para._calloutDot, {
      autoAlpha: 1,
      duration: 0.3,
      ease: "power2.out",
      delay: delay + 0.5,
    });
  }
}

function animateParaOut(para) {
  titleOut(para, 0);
  gsap.killTweensOf(para);
  gsap.to(para, {
    autoAlpha: 0,
    x: 30,
    duration: 0.4,
    ease: "power2.in",
    delay: 0.2,
  });

  if (para._calloutLine) {
    gsap.killTweensOf(para._calloutDot);
    gsap.to(para._calloutDot, {
      autoAlpha: 0,
      duration: 0.2,
      ease: "power2.in",
      delay: 0,
    });
    gsap.killTweensOf(para._calloutLine);
    gsap.to(para._calloutLine, {
      strokeDashoffset: para._calloutLength,
      duration: 0.4,
      ease: "power2.in",
      delay: 0.1,
    });
  }
}

export function initTitledParagraphs() {
  // Swap long/short body text based on page height (must run before callouts are built)
  function swapBodyText() {
    document.querySelectorAll(".tp-body[data-short]").forEach((body) => {
      if (!body._longHTML) body._longHTML = body.innerHTML;
      const page = body.closest(".page");
      if (!page) return;
      const useShort = page.getBoundingClientRect().height < 800;
      body.innerHTML = useShort ? body.dataset.short : body._longHTML;
    });
  }
  swapBodyText();

  document.querySelectorAll(".titled-para").forEach((para) => {
    buildTitle(para);
  });

  document.querySelectorAll(".page").forEach((page) => {
    const paras = Array.from(page.querySelectorAll(".titled-para"));
    if (!paras.length) return;

    // Build callouts after text swap so positions are correct
    buildCallouts(page);

    paras.forEach((para, pi) => {
      const titleWords = para.querySelectorAll(".tp-word");
      const underline = para.querySelector(".tp-underline");

      // Initial states
      titleWords.forEach((word, i) => {
        const dir = DIRECTIONS[i % DIRECTIONS.length];
        gsap.set(word, { x: dir.x, y: dir.y });
      });
      gsap.set(underline, { scaleX: 0 });
      gsap.set(para, { autoAlpha: 0, x: 30 });

      const paraDelay = pi * 0.15;

      ScrollTrigger.create({
        trigger: page,
        start: "top 60%",
        end: "top -20%",
        onEnter: () => animateParaIn(para, paraDelay),
        onLeave: () => animateParaOut(para),
        onEnterBack: () => animateParaIn(para, paraDelay),
        onLeaveBack: () => animateParaOut(para),
      });
    });
  });

  const pages = Array.from(document.querySelectorAll(".page"));
  window.addEventListener("resize", () => {
    requestAnimationFrame(() => {
      swapBodyText();
      pages.forEach((page) => updateCallouts(page));
    });
  });
}
