import { stats } from "./stats.js";
import { initSpriteCharacter } from "./sprite-character.js";
import { isMuted, setMuted } from "./audio-state.js";

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEBUG_MODE = false; // set to false to enable real API calls

// ── Speech blip sounds ──
const SPEECH_EVERY_N = 2; // play a blip every N characters
const SPEECH_BASE_FREQ = 300; // base frequency in Hz
const SPEECH_DETUNE_RANGE = 150; // ± random detune in cents
const SPEECH_DURATION = 0.1; // blip length in seconds
const SPEECH_VOLUME = 0.1; // 0–1

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx)
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playSpeechBlip() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  // Random waveform for variety
  const waves = ["square", "sawtooth", "triangle"];
  osc.type = waves[Math.floor(Math.random() * waves.length)];
  osc.frequency.value = SPEECH_BASE_FREQ;
  osc.detune.value = (Math.random() * 2 - 1) * SPEECH_DETUNE_RANGE;

  gain.gain.setValueAtTime(SPEECH_VOLUME, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + SPEECH_DURATION,
  );

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + SPEECH_DURATION);
}

function fmt(n) {
  return typeof n === "number" && !Number.isInteger(n) ? n.toFixed(1) : n;
}

function countWords(el) {
  const text = el ? el.textContent || "" : "";
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const WPM = 500;
const MIN_PAGE_TIME = 5;

function dfmt(n) {
  if (n === 0) return "—";
  const s = typeof n === "number" && !Number.isInteger(n) ? n.toFixed(1) : n;
  return n > 0 ? `+${s}` : `${s}`;
}

function dArr(arr) {
  if (!arr) return "—";
  return arr.map((v, i) => `#${i + 1}:${dfmt(v)}`).join(", ");
}

const SYSTEM_PROMPT = `You are a friendly, observant narrator embedded in an interactive pitch deck website created by a creative technologist applying to HYPERQUAKE (a creative agency). You've been watching the user interact with each page and now you're speaking directly to them.

The pitch deck has these pages:
- Title Page: An animated title made of voronoi cells
- Page 1: "Concentric Teams": A diagram about team structure
- Page 2: "Reusable Modules": Paragraphs of text with associated animations
- Page 3: "Visualize First": A large eye that follows the cursor
- Page 4: "The Work Pyramid": An interactive 3D pyramid builder
- Page 5: "AI Integration": This page — where you are now

Your behavior instructions will be provided in each user message as "DIRECTIVES". Follow every directive closely. In addition:
- Your tone is warm, friendly, and a little playful — like a colleague who's genuinely impressed by creative work and enjoys showing people around
- Keep it conversational and brief (3-5 sentences). They can be less if you're just going to repeat yourself.
- Don't be snarky or sarcastic — gentle teasing is fine but always land on encouragement
- Don't list things mechanically — weave observations into a natural narrative
- Don't mention stats, numbers, data, or tracking — just talk like a person who was watching
- Don't mention the AI page; it's the page you're on and doesn't make sense to mention
- When talking about a page use its title as described above
- Only mention a page if it is relevant; no need to mention the names of all the pages they didn't visit
- Use natural, flowing language — not bullet-point energy`;

function calcReadTime(words) {
  return +Math.max((words / WPM) * 60, MIN_PAGE_TIME).toFixed(1);
}

function buildStatsPayload(wordCounts) {
  const payload = {};
  for (const key of Object.keys(wordCounts)) {
    const { smallPyramidsBuilt, ...rest } = stats[key];
    payload[key] = {
      words: wordCounts[key],
      readTimeSec: calcReadTime(wordCounts[key]),
      ...rest,
      timeOnPage: +rest.timeOnPage.toFixed(1),
    };
  }
  return JSON.stringify(payload, null, 2);
}

// Conversation history persists across visits to page 05
const conversationHistory = [];
let lastSnapshot = null;
let lastDelta = null;
let lastDirectives = "";
const praisedPages = new Set();
const praisedEggs = new Set();
let completedBefore = false;

function snapshotStats(wordCounts) {
  return JSON.parse(buildStatsPayload(wordCounts));
}

function computeDelta(current, previous) {
  const delta = {};
  for (const page of Object.keys(current)) {
    delta[page] = {};
    for (const key of Object.keys(current[page])) {
      const cur = current[page][key];
      const prev = previous[page][key];
      if (Array.isArray(cur)) {
        delta[page][key] = cur.map((v, i) => v - prev[i]);
      } else if (typeof cur === "number") {
        delta[page][key] = +(cur - prev).toFixed(1);
      }
    }
  }
  return delta;
}

const PAGE_NAMES = {
  title: "Title Page",
  page01: "Concentric Teams",
  page02: "Reusable Modules",
  page03: "Visualize First",
  page04: "The Work Pyramid",
};

// Easter egg detection from cumulative stats
function detectEasterEggs(s) {
  const found = [];
  const missed = [];

  // Title shatter: clicked/dragged on title (mouseClickedDuration > 0 or mouseMovedClicked > 0)
  if (s.title.mouseClickedDuration > 0 || s.title.mouseMovedClicked > 0)
    found.push("shattered the HYPERQUAKE title apart and watched it reform");
  else
    missed.push(
      "try clicking or dragging on the HYPERQUAKE title — it shatters apart and reforms",
    );

  // Page 01 pulsate: clicked on concentric circles
  if (s.page01.clickCount > 0)
    found.push("made the concentric circles pulsate");
  else
    missed.push("try clicking on the Concentric Teams diagram — it pulsates");

  // Page 02 blobbify: clicked on page 02 (mouseHeldDuration > 0)
  if (s.page02.mouseHeldDuration > 0)
    found.push("blobbified the morphing animation on Reusable Modules");
  else
    missed.push(
      "try clicking and holding on the Reusable Modules page — it blobbifies the animation",
    );

  // Page 03 eye follow: moved the mouse around to make the eye follow
  if (s.page03.mouseMovingDuration > 0)
    found.push("moved the mouse around and noticed the eye following them");
  else
    missed.push(
      "try moving your mouse around on the Visualize First page — the eye follows you",
    );

  // Page 03 blink
  if (s.page03.blinkClicks > 0) found.push("made the eye blink");
  // Page 03 eye close
  if (s.page03.eyeCloses > 0) found.push("started closing the drowsy eye");
  // Page 03 eye sleep (the big one)
  if (s.page03.eyeSleeps > 0)
    found.push("put the eye to sleep and saw the little z's float up");
  else
    missed.push(
      "try holding the mouse down on the eye long enough — it falls asleep with little z's",
    );

  // Page 04 large pyramids
  if (s.page04.largePyramidsBuilt > 0)
    found.push("built the massive pyramids by holding down the mouse");
  else
    missed.push(
      "try holding the mouse down on The Work Pyramid — everything speeds up and builds much larger pyramids",
    );

  // Page 05 WASD: moved the robot around with WASD keys
  if (s.page05.wasdPresses > 0)
    found.push("discovered the WASD controls and flew the robot around");
  else
    missed.push(
      "try pressing WASD on the AI page — you can fly the little robot around",
    );

  return { found, missed };
}

function analyzeBehavior(current, delta) {
  const directives = [];
  let n = 1;
  const pages = ["page01", "page02", "page03", "page04"];

  // Determine visited vs skipped vs readWell
  const visited = [];
  const readWell = []; // spent more than word-count read time
  const skipped = [];

  for (const key of pages) {
    const time = delta ? delta[key].timeOnPage : current[key].timeOnPage;
    const totalTime = current[key].timeOnPage;
    const readTimeSec = current[key].readTimeSec;

    if (totalTime >= readTimeSec) {
      visited.push(key);
      readWell.push(key);
    } else if (time >= MIN_PAGE_TIME || totalTime >= MIN_PAGE_TIME) {
      visited.push(key);
    } else {
      skipped.push(key);
    }
  }

  // Return visit: user just scrolled up and right back down (no new reading, nothing new to skip)
  if (delta && visited.length === 0 && skipped.length === 0) {
    directives.push(
      `${n++}. The user scrolled away and came right back without spending meaningful time on any page. Tease them gently. Keep it very short (1-2 sentences). Example tones: 'Back so soon?', 'Peek-a-boo!', 'Uh... I'm still here, go do your thing!', 'That was quick — I don't think you even made it past the first page!'`,
    );
    return (
      "YOU MUST ADDRESS EVERY NUMBERED DIRECTIVE BELOW. Weave them together naturally.\n\n" +
      directives.join("\n")
    );
  }

  // All pages skipped (first visit speedrun)
  if (!delta && visited.length === 0) {
    directives.push(
      `${n++}. The user scrolled through every page without really reading — they speedran to this page. Joke about their eagerness. Nudge them to go back up and actually read. Examples: 'I understand you came down here quickly because you thought I might be lonely, but it's ok — go up there and read, I'll be here when you're done.' Be warm and playful.`,
    );
  }

  // Commend if read well (only new pages not already praised)
  const newReadWell = readWell.filter((k) => !praisedPages.has(k));
  if (newReadWell.length > 0) {
    if (newReadWell.length === pages.length) {
      directives.push(
        `${n++}. The user spent more than the estimated reading time on EVERY page. Commend them warmly — they clearly took their time to absorb everything.`,
      );
    } else {
      const names = newReadWell.map((k) => PAGE_NAMES[k]);
      directives.push(
        `${n++}. The user spent more than the reading time on: ${names.join(", ")}. Thank them warmly for taking their time on ${newReadWell.length === 1 ? "that page" : "those pages"}.`,
      );
    }
    newReadWell.forEach((k) => praisedPages.add(k));
  }

  // Skipped pages nudge
  if (skipped.length > 0 && skipped.length <= 2) {
    const names = skipped.map((k) => PAGE_NAMES[k]);
    directives.push(
      `${n++}. The user didn't spend enough time on: ${names.join(", ")}. Gently nudge them to go back and check ${skipped.length === 1 ? "it" : "them"} out. Don't shame them. Example tone: "Go back up there and take a look, I'll be here when you get back."`,
    );
  } else if (skipped.length > 2) {
    directives.push(
      `${n++}. The user didn't spend enough time on ${skipped.length} pages. Gently nudge them to go explore more. Don't list the specific page names since there are many. Example tone: "There's a lot more up there worth exploring — go take your time, I'll be here when you're done."`,
    );
  }

  // Easter eggs (only mention newly found ones)
  const eggs = detectEasterEggs(current);
  const newEggs = eggs.found.filter((e) => !praisedEggs.has(e));

  if (newEggs.length > 0) {
    directives.push(
      `${n++}. The user discovered these easter eggs — acknowledge with delight: ${newEggs.join("; ")}.`,
    );
    newEggs.forEach((e) => praisedEggs.add(e));
  }

  // Reveal a missed easter egg if they visited 3+ pages
  if (visited.length >= 3 && eggs.missed.length > 0) {
    directives.push(
      `${n++}. IMPORTANT: Since the user explored well, reveal ONE missed easter egg. The easter egg to reveal: "${eggs.missed[0]}". If the egg is on THIS page (the AI page), tell them to try it right now. If it's on another page, tell them to go try it and come back. ${eggs.missed.length > 1 ? "There are more easter eggs after this one — say something like 'Try that and I'll tell you about another!'" : ""}`,
    );
  }

  if (delta) {
    directives.push(
      `${n++}. IMPORTANT: You have already spoken to this user before. Do NOT repeat things you've already said. Focus only on what's NEW since your last comment.`,
    );
  }

  // Everything done: all pages visited and all easter eggs found
  const allDone = visited.length === pages.length && eggs.missed.length === 0;
  if (allDone) {
    if (completedBefore) {
      directives.push(
        `${n++}. The user has already seen everything. Keep it very short — just tell them there's nothing new and say something fun or random.`,
      );
    } else {
      directives.push(
        `${n++}. The user has visited every page AND found every easter egg — there's nothing left to discover! Congratulate them, tell them they've seen everything, and say something fun and random to close things out.`,
      );
    }
    completedBefore = true;
  }

  const brief = allDone && directives.length === 1;
  return (
    (brief
      ? "Follow the directive below. Keep it to 1-2 sentences.\n\n"
      : "YOU MUST ADDRESS EVERY NUMBERED DIRECTIVE BELOW. Weave them together naturally into 3-5 sentences.\n\n") +
    directives.join("\n")
  );
}

function buildUserMessage(wordCounts) {
  const current = snapshotStats(wordCounts);

  if (lastSnapshot) {
    lastDelta = computeDelta(current, lastSnapshot);
  }

  lastDirectives = analyzeBehavior(current, lastDelta);
  lastSnapshot = current;
  return lastDirectives;
}

const DEBUG_RESPONSES = [
  "Hey there! I noticed you spent quite a bit of time on Concentric Teams — that diagram really pulls you in, doesn't it? You should check out Visualize First next, the eye tracking is something else.",
  "Welcome back! Looks like you've been exploring The Work Pyramid. Those pyramids are fun to build, right? There's a little secret if you hold the mouse down longer...",
  "I see you've been clicking around on Reusable Modules — nice! Each one of those animations took ages to get right. Go have a look at the eye on Visualize First if you haven't already.",
];

async function fetchGroqComment(wordCounts) {
  if (DEBUG_MODE) {
    await new Promise((r) => setTimeout(r, 500)); // fake delay
    return DEBUG_RESPONSES[Math.floor(Math.random() * DEBUG_RESPONSES.length)];
  }
  if (!GROQ_API_KEY || GROQ_API_KEY === "your-groq-api-key-here") return null;

  const userMsg = buildUserMessage(wordCounts);
  conversationHistory.push({ role: "user", content: userMsg });

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversationHistory,
      ],
      temperature: 0.9,
      max_tokens: 256,
    }),
  });

  if (!res.ok) {
    console.error("Groq API error:", res.status, await res.text());
    conversationHistory.pop(); // remove failed user message
    return null;
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || null;
  if (reply) {
    conversationHistory.push({ role: "assistant", content: reply });
  }
  return reply;
}

// Map page names to their DOM selectors for clickable links
const PAGE_LINKS = {
  "Title Page": "#title-page",
  "Concentric Teams": "#page-01",
  "Reusable Modules": "#page-02",
  "Visualize First": "#page-03",
  "The Work Pyramid": "#page-04",
};

// Replace page names in text with clickable links
function linkifyPageNames(text) {
  let result = text;
  for (const [name, selector] of Object.entries(PAGE_LINKS)) {
    const re = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    result = result.replace(
      re,
      `<a class="ai-page-link" data-target="${selector}">${name}</a>`,
    );
  }
  return result;
}

// Typing delay constants (ms) — [base, randomExtra]
const DELAY_CHAR = [10, 20];
const DELAY_WORD = [30, 60];
const DELAY_COMMA = [80, 120];
const DELAY_SENTENCE = [250, 500];

// Typewriter: types text character by character with natural delays
function typeWriter(container, html, onDone) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = linkifyPageNames(html);
  const fullText = tempDiv.textContent;
  const fullHtml = tempDiv.innerHTML;

  const textEl = container.querySelector(".ai-text");
  const caret = container.querySelector(".ai-caret");
  let charIndex = 0;
  let cancelled = false;
  let blipCounter = 0;

  // Build a mapping: for each plaintext char, figure out the html up to that point
  // Simpler approach: reveal the full html but only show characters progressively
  const htmlChars = [];
  let inTag = false;
  let textCount = 0;
  for (let i = 0; i < fullHtml.length; i++) {
    if (fullHtml[i] === "<") inTag = true;
    if (!inTag) textCount++;
    htmlChars.push({
      ch: fullHtml[i],
      inTag,
      textIndex: inTag ? -1 : textCount,
    });
    if (fullHtml[i] === ">") inTag = false;
  }

  function htmlUpTo(n) {
    // Return html string that shows first n plaintext characters
    // Include all tags that appear before or at char n
    let result = "";
    let shown = 0;
    let inside = false;
    for (let i = 0; i < fullHtml.length; i++) {
      if (fullHtml[i] === "<") inside = true;
      if (inside) {
        result += fullHtml[i];
        if (fullHtml[i] === ">") inside = false;
      } else {
        shown++;
        if (shown <= n) result += fullHtml[i];
        else break;
      }
    }
    // Close any unclosed tags
    return result;
  }

  function nextDelay() {
    const ch = fullText[charIndex - 1] || "";
    // Sentence end: longer pause
    if (ch === "." || ch === "!" || ch === "?")
      return DELAY_SENTENCE[0] + Math.random() * DELAY_SENTENCE[1];
    // Word boundary
    if (ch === " ") return DELAY_WORD[0] + Math.random() * DELAY_WORD[1];
    // Comma/semicolon
    if (ch === "," || ch === ";")
      return DELAY_COMMA[0] + Math.random() * DELAY_COMMA[1];
    // Regular character
    return DELAY_CHAR[0] + Math.random() * DELAY_CHAR[1];
  }

  function step() {
    if (cancelled) return;
    if (charIndex >= fullText.length) {
      if (caret) caret.remove();
      if (onDone) onDone();
      return;
    }
    charIndex++;
    blipCounter++;
    if (blipCounter >= SPEECH_EVERY_N) {
      blipCounter = 0;
      if (!isMuted()) playSpeechBlip();
    }
    textEl.innerHTML = htmlUpTo(charIndex);
    // Re-attach click handlers on links
    attachPageLinkHandlers(container);
    setTimeout(step, nextDelay());
  }

  step();

  return {
    cancel() {
      cancelled = true;
      textEl.innerHTML = fullHtml;
      if (caret) caret.remove();
      attachPageLinkHandlers(container);
      if (onDone) onDone();
    },
  };
}

function attachPageLinkHandlers(container) {
  container.querySelectorAll(".ai-page-link").forEach((link) => {
    if (link._bound) return;
    link._bound = true;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.querySelector(link.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });
}

export function initAIPage() {
  const page = document.querySelector("#page-05");
  if (!page) return;

  // Count words per page at init
  const wordCounts = {
    title: 7, // "MY VISION FOR CREATIVE TECH AT HYPERQUAKE"
    page01: countWords(document.querySelector("#page-01")),
    page02: countWords(document.querySelector("#page-02")),
    page03: countWords(document.querySelector("#page-03")),
    page04: countWords(document.querySelector("#page-04")),
    page05: countWords(page),
  };

  // ── AI Panel ──
  const panel = document.createElement("div");
  panel.className = "ai-panel";
  panel.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-robot"></div>
    </div>
    <div class="ai-panel-body">
      <span class="ai-text"></span><span class="ai-caret"></span>
    </div>
    <button class="ai-replay" title="Replay">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10"></polyline>
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
      </svg>
    </button>
    <button class="ai-mute" title="Mute">
      <svg class="icon-unmuted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
      </svg>
      <svg class="icon-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>
      </svg>
    </button>
  `;
  page.appendChild(panel);

  // ── Sprite character ──
  const sprite = initSpriteCharacter(page, panel);

  // ── Debug stats (only in debug mode) ──
  const wrap = document.createElement("div");
  wrap.className = "ai-stats";
  //if (DEBUG_MODE) page.appendChild(wrap);

  // AI comment state
  let aiFetching = false;
  let wasVisible = false;
  let currentTyper = null;
  let lastComment = null;

  function showComment(text) {
    lastComment = text;
    const body = panel.querySelector(".ai-panel-body");
    body.innerHTML = `<span class="ai-text"></span><span class="ai-caret"></span>`;
    sprite.startTalking();
    currentTyper = typeWriter(body, text, () => {
      currentTyper = null;
      sprite.stopTalking();
    });
  }

  panel.querySelector(".ai-replay").addEventListener("click", () => {
    if (lastComment && !aiFetching) {
      finishTypingImmediately();
      showComment(lastComment);
    }
  });

  const muteBtn = panel.querySelector(".ai-mute");
  muteBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    muteBtn.classList.toggle("muted", isMuted());
  });

  function finishTypingImmediately() {
    if (currentTyper) {
      currentTyper.cancel();
      currentTyper = null;
      sprite.stopTalking();
    }
  }

  function renderDebug() {
    wrap.innerHTML = `
      <div class="ai-stats-section">
        <h3>Title Page</h3>
        <ul>
          <li>Words: ${wordCounts.title} (~${calcReadTime(wordCounts.title)}s to read)</li>
          <li>HYPERQUAKE jitters: ${fmt(stats.title.jitterCount)}</li>
          <li>Mouse moved (unclicked): ${fmt(stats.title.mouseMovedUnclicked)}s</li>
          <li>Clicks: ${fmt(stats.title.clickCount)}</li>
          <li>Mouse held: ${fmt(stats.title.mouseClickedDuration)}s</li>
          <li>Mouse moved (clicked): ${fmt(stats.title.mouseMovedClicked)}s</li>
          <li>Time on page: ${fmt(stats.title.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section">
        <h3>01 — Concentric Teams</h3>
        <ul>
          <li>Words: ${wordCounts.page01} (~${calcReadTime(wordCounts.page01)}s to read)</li>
          <li>Clicks: ${fmt(stats.page01.clickCount)}</li>
          <li>Time on page: ${fmt(stats.page01.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section">
        <h3>02 — Reusable Modules</h3>
        <ul>
          <li>Words: ${wordCounts.page02} (~${calcReadTime(wordCounts.page02)}s to read)</li>
          <li>Para reveals: ${stats.page02.paraReveals.map((v, i) => `#${i + 1}:${v}`).join(", ")}</li>
          <li>Para hovers: ${stats.page02.paraHovers.map((v, i) => `#${i + 1}:${v}`).join(", ")}</li>
          <li>Clicks: ${fmt(stats.page02.clickCount)}</li>
          <li>Mouse held: ${fmt(stats.page02.mouseHeldDuration)}s</li>
          <li>Time on page: ${fmt(stats.page02.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section">
        <h3>03 — Visualize First</h3>
        <ul>
          <li>Words: ${wordCounts.page03} (~${calcReadTime(wordCounts.page03)}s to read)</li>
          <li>Mouse moving: ${fmt(stats.page03.mouseMovingDuration)}s</li>
          <li>Blink clicks: ${fmt(stats.page03.blinkClicks)}</li>
          <li>Eye closes: ${fmt(stats.page03.eyeCloses)}</li>
          <li>Eye fell asleep: ${fmt(stats.page03.eyeSleeps)}</li>
          <li>Time on page: ${fmt(stats.page03.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section">
        <h3>04 — The Work Pyramid</h3>
        <ul>
          <li>Words: ${wordCounts.page04} (~${calcReadTime(wordCounts.page04)}s to read)</li>
          <li>Small pyramids built: ${fmt(stats.page04.smallPyramidsBuilt)}</li>
          <li>Large pyramids built: ${fmt(stats.page04.largePyramidsBuilt)}</li>
          <li>Mouse moving: ${fmt(stats.page04.mouseMovingDuration)}s</li>
          <li>Mouse pressed: ${fmt(stats.page04.mousePressedDuration)}s</li>
          <li>Clicks: ${fmt(stats.page04.clickCount)}</li>
          <li>Time on page: ${fmt(stats.page04.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section">
        <h3>05 — AI Integration</h3>
        <ul>
          <li>Words: ${wordCounts.page05} (~${calcReadTime(wordCounts.page05)}s to read)</li>
          <li>Time on page: ${fmt(stats.page05.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section">
        <h3>Easter Eggs</h3>
        <ul>
          ${(() => {
            const eggs = detectEasterEggs(stats);
            return [
              ...eggs.found.map(
                (e) => `<li style="color:#4a4">&#10003; ${e}</li>`,
              ),
              ...eggs.missed.map(
                (e) => `<li style="color:#a44">&#10007; ${e}</li>`,
              ),
            ].join("\n          ");
          })()}
        </ul>
      </div>
      ${
        lastDirectives
          ? `
      <div class="ai-stats-section" style="flex-basis:100%">
        <h3>Directives Sent</h3>
        <pre style="white-space:pre-wrap;font-size:0.65rem;color:#666">${lastDirectives}</pre>
      </div>
      `
          : ""
      }
      ${
        lastDelta
          ? `
      <h3 class="ai-delta-heading">Delta (since last AI comment)</h3>
      <div class="ai-stats-section ai-delta">
        <h3>Title Page</h3>
        <ul>
          <li>HYPERQUAKE jitters: ${dfmt(lastDelta.title.jitterCount)}</li>
          <li>Mouse moved (unclicked): ${dfmt(lastDelta.title.mouseMovedUnclicked)}s</li>
          <li>Clicks: ${dfmt(lastDelta.title.clickCount)}</li>
          <li>Mouse held: ${dfmt(lastDelta.title.mouseClickedDuration)}s</li>
          <li>Mouse moved (clicked): ${dfmt(lastDelta.title.mouseMovedClicked)}s</li>
          <li>Time on page: ${dfmt(lastDelta.title.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section ai-delta">
        <h3>01 — Concentric Teams</h3>
        <ul>
          <li>Clicks: ${dfmt(lastDelta.page01.clickCount)}</li>
          <li>Time on page: ${dfmt(lastDelta.page01.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section ai-delta">
        <h3>02 — Reusable Modules</h3>
        <ul>
          <li>Para reveals: ${dArr(lastDelta.page02.paraReveals)}</li>
          <li>Para hovers: ${dArr(lastDelta.page02.paraHovers)}</li>
          <li>Clicks: ${dfmt(lastDelta.page02.clickCount)}</li>
          <li>Mouse held: ${dfmt(lastDelta.page02.mouseHeldDuration)}s</li>
          <li>Time on page: ${dfmt(lastDelta.page02.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section ai-delta">
        <h3>03 — Visualize First</h3>
        <ul>
          <li>Mouse moving: ${dfmt(lastDelta.page03.mouseMovingDuration)}s</li>
          <li>Blink clicks: ${dfmt(lastDelta.page03.blinkClicks)}</li>
          <li>Eye closes: ${dfmt(lastDelta.page03.eyeCloses)}</li>
          <li>Eye fell asleep: ${dfmt(lastDelta.page03.eyeSleeps)}</li>
          <li>Time on page: ${dfmt(lastDelta.page03.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section ai-delta">
        <h3>04 — The Work Pyramid</h3>
        <ul>
          <li>Small pyramids built: ${dfmt(lastDelta.page04.smallPyramidsBuilt)}</li>
          <li>Large pyramids built: ${dfmt(lastDelta.page04.largePyramidsBuilt)}</li>
          <li>Mouse moving: ${dfmt(lastDelta.page04.mouseMovingDuration)}s</li>
          <li>Mouse pressed: ${dfmt(lastDelta.page04.mousePressedDuration)}s</li>
          <li>Clicks: ${dfmt(lastDelta.page04.clickCount)}</li>
          <li>Time on page: ${dfmt(lastDelta.page04.timeOnPage)}s</li>
        </ul>
      </div>
      <div class="ai-stats-section ai-delta">
        <h3>05 — AI Integration</h3>
        <ul>
          <li>Time on page: ${dfmt(lastDelta.page05.timeOnPage)}s</li>
        </ul>
      </div>
      `
          : ""
      }
    `;
    requestAnimationFrame(renderDebug);
  }
  if (DEBUG_MODE) requestAnimationFrame(renderDebug);

  // Fetch AI comment each time page 05 becomes visible
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries[0].isIntersecting;
      if (visible && !wasVisible) {
        sprite.activate();
        if (!aiFetching) {
          // Show thinking state
          const body = panel.querySelector(".ai-panel-body");
          body.innerHTML = `<span class="ai-text" style="color:#999">Thinking...</span><span class="ai-caret"></span>`;
          aiFetching = true;
          fetchGroqComment(wordCounts).then((comment) => {
            if (comment) showComment(comment);
            aiFetching = false;
          });
        }
      }
      // If user navigates away, finish typing immediately and pause sprite
      if (!visible && wasVisible) {
        finishTypingImmediately();
        sprite.deactivate();
      }
      wasVisible = visible;
    },
    { threshold: 0.3 },
  );
  observer.observe(page);
}
