import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const FADE_COLOR = "#ccc"; // dimmed word color
const ACTIVE_COLOR = "#333"; // highlighted word color

export function initHighlightParagraphs() {
  document.querySelectorAll(".highlight-para").forEach((para) => {
    const page = para.closest(".page");
    if (!page) return;

    // Split into word spans, preserving inline formatting (e.g. <b>)
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const wordEls = [];
    textNodes.forEach((node) => {
      const parent = node.parentNode;
      const isBold = parent.closest && parent.closest("b, strong");
      const parts = node.textContent.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(" "));
        } else if (part) {
          const span = document.createElement("span");
          span.className = "hp-word";
          if (isBold) span.style.fontWeight = "800";
          span.textContent = part;
          wordEls.push(span);
          frag.appendChild(span);
        }
      });
      parent.replaceChild(frag, node);
    });
    // Bold wrappers now contain hp-word spans; keep them for nowrap
    para.querySelectorAll("b, strong").forEach((el) => {
      el.style.whiteSpace = "nowrap";
    });

    // Scrub-driven highlight: scroll down reveals, scroll up unreveals
    ScrollTrigger.create({
      trigger: page,
      start: "top 60%",
      end: "top 10%",
      scrub: 0.3,
      animation: gsap.timeline().fromTo(
        wordEls,
        { color: FADE_COLOR },
        {
          color: ACTIVE_COLOR,
          stagger: { each: 0.02 },
          duration: 0.5,
        }
      ),
    });
  });
}
