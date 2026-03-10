import gsap from "gsap";

export function initFinPage() {
  const finText = document.querySelector(".fin-text");
  const finMirror = document.querySelector(".fin-mirror");
  const finReflection = document.querySelector(".fin-reflection");
  if (!finText) return;

  const scrollTrigger = {
    trigger: "#page-fin",
    start: "top 50%",
    end: "top 0%",
    scrub: true,
  };

  gsap.fromTo(
    finText,
    { yPercent: 100 },
    { yPercent: 0, ease: "none", scrollTrigger },
  );

  if (finMirror) {
    gsap.fromTo(
      finMirror,
      { "--mirror-rise": "0%" },
      { "--mirror-rise": "100%", ease: "none", scrollTrigger },
    );
  }

  if (finReflection) {
    gsap.fromTo(
      finReflection,
      { "--rise": "100%" },
      { "--rise": "-0%", ease: "none", scrollTrigger },
    );
  }

  if (finReflection) {
    window.addEventListener("mousemove", (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * -2; // -1 to 1, flipped
      finReflection.style.setProperty("--skew", `${x * 20}deg`);
    });
  }
}
