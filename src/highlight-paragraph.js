import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const FADE_COLOR = "#ccc"; // dimmed word color
const ACTIVE_COLOR = "#333"; // highlighted word color

export function initHighlightParagraphs() {
  document.querySelectorAll(".highlight-para").forEach((para) => {
    const page = para.closest(".page");
    if (!page) return;

    // Split text into word spans
    const text = para.textContent.trim();
    para.textContent = "";

    const words = text.split(/\s+/);
    const wordEls = words.map((word, i) => {
      const span = document.createElement("span");
      span.className = "hp-word";
      span.textContent = word;
      para.appendChild(span);
      if (i < words.length - 1) para.appendChild(document.createTextNode(" "));
      return span;
    });

    // Scrub-driven highlight: scroll down reveals, scroll up unreveals
    ScrollTrigger.create({
      trigger: page,
      start: "top 40%",
      end: "top -10%",
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
