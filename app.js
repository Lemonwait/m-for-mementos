(function () {
  // The reel keeps its own record of the current card for reloads (see
  // rememberCard), so the browser's scroll restoration is switched off.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const eventsRoot = document.getElementById("events");
  const yearRail = document.getElementById("year-rail");
  const counterEl = document.getElementById("counter");
  const progressBar = document.getElementById("progress-bar");
  // See mountCustomPlayer's own comment on why the active video's
  // .yt-frame gets physically relocated here while mounted, rather than
  // staying nested inside its own .event-media.
  const videoSlot = document.getElementById("video-slot");
  // A real, confirmed bug otherwise: nesting inside .event-media used to
  // give the video's visibility for free (opacity:0 until .event.active
  // landed on its own parent) -- once relocated to this single shared
  // slot, NOTHING gated it anymore, so a video mounted the instant
  // activateObserver's raw intersection crossed 0.5, well before the
  // page agreed this was the settled, current card. Confirmed live: fast
  // scrolling showed the blinds reveal playing out mid-animation on
  // cards that were only ever briefly crossed, never actually landed on.
  //
  // Gates on activeSection, checked against a short debounce of ITS OWN
  // -- not currentIdx (scheduleSnap's discrete, wheel-driven "committed"
  // index), which sounds like the more natural fit but turned out to
  // have the opposite problem in testing: after a real (not scripted)
  // wheel scroll, currentIdx's own 125ms debounce measures net movement
  // via window.scrollY at that deadline, and can read the page's still-
  // mid-smooth-scroll position and settle on the wrong card -- confirmed
  // live as activeSection and currentIdx correctly agreeing on Concept
  // Trailer II while gating on currentIdx alone still reported hidden,
  // i.e. currentIdx pointed somewhere else briefly even once the visible
  // card had already genuinely settled. activeSection (updateDisplay's
  // own plain getBoundingClientRect visibility check on every 'scroll'
  // event) doesn't share that failure mode, but IS deliberately live/
  // un-debounced for the art/text layer it actually drives, so it can
  // just as easily agree with a freshly-mounting card for a single
  // transient instant mid-fast-scroll. Debouncing the REVEAL specifically
  // (hide instantly the moment they disagree, but only show again once
  // they've agreed for a short beat with nothing re-triggering in
  // between) gets the settle-detection this needs without inheriting
  // either variable's own failure mode.
  //
  // Called from both sides of that gap -- wherever activeSection itself
  // changes (updateDisplay and the two ending-swipe functions), and
  // wherever the mounted holder itself changes (mountCustomPlayer,
  // unmountVideoPlayer) -- since either one moving independently of the
  // other is exactly the window this bug lived in.
  let videoRevealTimer = null;
  function syncVideoSlotVisibility() {
    clearTimeout(videoRevealTimer);
    // Any holder in the slot, not just the first: a video left behind by the
    // reel (see retireEntry) can sit beside the active card's own for a
    // moment.
    const owned = [...videoSlot.querySelectorAll(".yt-frame")].some(
      (holder) => holder._homeParent && holder._homeParent.closest(".event") === activeSection
    );
    if (!activeSection || !owned) {
      videoSlot.classList.remove("showing");
      return;
    }
    videoRevealTimer = setTimeout(() => {
      videoSlot.classList.add("showing");
    }, 150);
  }

  const total = MEMENTOS.length;
  const years = [...new Set(MEMENTOS.map((m) => m.year))];
  // "n / total", as used by the top counter and the roulette caption, with
  // no leading zeros. Each side sits in its own fixed-width slot (the
  // .n-cur/.n-all rules in style.css), so neither the digits' uneven widths
  // nor the number's length can move the slash or resize the box around it.
  function countHtml(n) {
    return `<span class="n-cur">${n}</span><span class="n-sep">/</span><span class="n-all">${total}</span>`;
  }


  // ---- build year rail ----
  const yearButtons = {};
  years.forEach((year) => {
    const btn = document.createElement("button");
    btn.className = "year-dot";
    btn.dataset.year = year;
    btn.innerHTML = `<span class="dot"></span><span class="label">${year}</span>`;
    btn.addEventListener("click", () => {
      const first = MEMENTOS.find((m) => m.year === year);
      const target = document.getElementById(`event-${first.i}`);
      if (target) {
        reelJumpTo(snapTargets.indexOf(target));
      }
    });
    yearRail.appendChild(btn);
    yearButtons[year] = btn;
  });

  // ---- build event sections ----
  const frag = document.createDocumentFragment();
  MEMENTOS.forEach((m) => {
    const section = document.createElement("section");
    section.className = "event";
    section.id = `event-${m.i}`;
    section.dataset.year = m.year;
    section.dataset.index = m.i;

    const tagsHtml = m.tags
      .map((t) => {
        if (!t.url) return `<span class="tag-chip">${escapeHtml(t.label)}</span>`;
        // t.ytId is an explicit override for when the tag's own url
        // points somewhere non-YouTube (e.g. Bilibili) on purpose --
        // that link is what double-click/long-press opens, but the
        // in-site embed still plays this id rather than having nothing
        // to switch to. Falls back to extracting from the url itself
        // for every ordinary tag that doesn't set this.
        const ytId = t.ytId || extractYoutubeId(t.url);
        if (!ytId) {
          return `<a class="tag-chip" href="${escapeAttr(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.label)}</a>`;
        }
        // Switchable variant: a real click plays it in-site instead of
        // navigating away (see the click/dblclick/long-press wiring
        // below), so this is a <button>, not a link -- there's no
        // href for a single click to ever fall back to by mistake.
        // Starts pre-selected when it's the one m.video.id (and
        // therefore the .yt-frame's own initial video) already came
        // from, so the highlighted chip matches what's actually
        // playing from the very first paint, not just after a click.
        const selected = m.video && ytId === m.video.id;
        return `<button type="button" class="tag-chip${selected ? " selected" : ""}" data-yt-id="${escapeAttr(ytId)}" data-url="${escapeAttr(t.url)}">${escapeHtml(t.label)}</button>`;
      })
      .join("");

    // Every video card (any m.video, not just one special-cased ID) gets
    // no load button at all: its .yt-frame starts empty, and
    // mountCustomPlayer() populates it once the card scrolls into view --
    // same no-click, autoplaying, custom-controlled treatment Concept
    // Trailer III got first, now applied site-wide.
    const videoHtml = m.video
      ? `<div class="yt-frame" data-yt-id="${escapeAttr(m.video.id)}"${
          m.video.start != null ? ` data-yt-start="${m.video.start}"` : ""
        }${m.video.end != null ? ` data-yt-end="${m.video.end}"` : ""}></div>`
      : "";

    section.innerHTML = `
      <div class="event-media${m.video ? " has-video" : ""}">
        <img data-src="${escapeAttr(m.image)}" alt="${escapeAttr(m.name)}" loading="lazy" decoding="async">
        ${videoHtml}
      </div>
      <div class="event-body">
        <p class="event-index">${String(m.i + 1).padStart(3, "0")} / ${String(total).padStart(3, "0")}</p>
        <p class="event-date">${escapeHtml(formatDateShort(m.date))}</p>
        ${m.favorText ? `<p class="event-quote">${escapeHtml(m.favorText)}</p>` : ""}
        <h2 class="event-name">${escapeHtml(m.name)}</h2>
        <div class="event-tags">${tagsHtml}</div>
      </div>
    `;
    frag.appendChild(section);

    // Single click plays the variant in-site; double click or a
    // press-and-hold instead opens its real YouTube page, exactly like
    // the request specified. clickTimer is what makes single vs double
    // distinguishable at all: a lone click doesn't act until this delay
    // passes unchallenged, since the browser's own click/click/dblclick
    // sequence means a genuine double-click always fires two plain
    // clicks first -- each one just re-arms the same pending timer
    // (never reaching zero) until dblclick itself cancels it for good.
    // longPressFired guards the click handler from ALSO firing once the
    // mouse is released after a long-press already acted.
    section.querySelectorAll("button.tag-chip[data-yt-id]").forEach((btn) => {
      let longPressTimer = null;
      let longPressFired = false;
      let clickTimer = null;
      btn.addEventListener("mousedown", () => {
        longPressFired = false;
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          window.open(btn.dataset.url, "_blank", "noopener");
        }, 550);
      });
      btn.addEventListener("mouseup", () => clearTimeout(longPressTimer));
      btn.addEventListener("mouseleave", () => clearTimeout(longPressTimer));
      btn.addEventListener("click", () => {
        if (longPressFired) {
          longPressFired = false;
          return;
        }
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => switchTagVariant(section, btn), 250);
      });
      btn.addEventListener("dblclick", () => {
        clearTimeout(clickTimer);
        window.open(btn.dataset.url, "_blank", "noopener");
      });
    });

    // "info chunk" -- see pauseAutoHideForHover's own comment for why
    // reading the quote/name/tags shouldn't get yanked away out from
    // under the mouse just for sitting still. Each piece individually,
    // not the shared .event-body wrapper -- that one's deliberately
    // pointer-events:none (see its own CSS comment) and would never
    // actually receive a hover to begin with.
    section.querySelectorAll(".event-index, .event-date, .event-quote, .event-name, .event-tags").forEach((el) => {
      el.addEventListener("mouseenter", pauseAutoHideForHover);
      el.addEventListener("mouseleave", resumeAutoHideAfterHover);
    });
  });
  eventsRoot.appendChild(frag);

  // Swaps the event's already-mounted player over to a different tag's
  // video via the YouTube IFrame API's own loadVideoById, rather than
  // tearing down and remounting -- keeps the existing progress-bar
  // polling/seek-track wiring (both bound to this same player instance)
  // working untouched against whatever's currently loaded. Re-applies
  // the site's mute/volume state explicitly afterward rather than
  // trusting it to survive the swap -- the same lesson as
  // setSoundEnabled's own fix earlier: don't assume a YouTube API call
  // leaves an unrelated-sounding setting alone. Also updates the
  // holder's own data-yt-id, so scrolling this card out and back (a
  // full unmount/remount, see enforceMountCap) resumes whichever
  // variant was last picked instead of reverting to the default PV.
  // Falls back to just opening the link if the player isn't actually
  // ready yet (e.g. clicked the instant the card came into view) --
  // there's nothing to swap in that case.
  function switchTagVariant(section, btn) {
    const holder = section._videoHolder;
    const entry = holder && entryByHolder.get(holder);
    if (!entry || !entry.player || typeof entry.player.loadVideoById !== "function") {
      window.open(btn.dataset.url, "_blank", "noopener");
      return;
    }
    const newId = btn.dataset.ytId;
    if (holder.dataset.ytId === newId) return; // already the active variant
    entry.player.loadVideoById(newId);
    holder.dataset.ytId = newId;
    if (typeof entry.player.setVolume === "function") entry.player.setVolume(volumeLevel);
    if (soundEnabled) {
      if (typeof entry.player.unMute === "function") entry.player.unMute();
    } else if (typeof entry.player.mute === "function") {
      entry.player.mute();
    }
    section.querySelectorAll(".tag-chip[data-yt-id]").forEach((el) => {
      el.classList.toggle("selected", el === btn);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }
  // Same extraction data.js's own video.id was hand-derived with (youtu.be
  // short links and youtube.com/watch?v= both covered) -- run live here
  // instead of baked into the data, so a tag switching between "plays
  // in-site" and "just links out" is purely a function of its own URL,
  // not something that needs updating in two places. Bilibili/wiki/etc.
  // links (a handful of tags, mostly recent CN-only entries) simply don't
  // match, and fall back to the plain external-link rendering below.
  function extractYoutubeId(url) {
    const match = /(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/.exec(url || "");
    return match ? match[1] : null;
  }
  // The big year watermark now covers the year itself, so the small date
  // line only needs "Mon DD" — strips a trailing ", YYYY". The one entry
  // whose date is just a bare year ("2017", no month/day at all) has
  // nothing left to show here once the year's stripped, which is fine:
  // that year is exactly what the watermark is already displaying.
  function formatDateShort(dateStr) {
    const match = dateStr.match(/^(.*),\s*\d{4}$/);
    return match ? match[1] : "";
  }

  // ---- lazy image fade-in via IntersectionObserver ----
  // Unlike the active-card tracking below, this one is fine as an
  // observer: it only ever fires once per image, and being a frame or two
  // late to start loading an image that's about to scroll into view has
  // no correctness consequence — nothing downstream depends on exactly
  // when it fires the way the counter/roadblock used to.
  //
  // Watches .event (plain normal-flow document position) rather than the
  // img itself -- confirmed live bug: the img's own ancestor .event-media
  // is position:fixed, inset:0 (deliberately -- see its own comment in
  // style.css for why), which pins it to the viewport rectangle from the
  // instant the page loads, geometrically "intersecting" regardless of
  // scroll position. Observing it directly meant EVERY image's src got
  // set at once on page load (confirmed: all 131 already .complete with
  // zero scrolling), not lazily as each card was approached -- 131
  // concurrent requests racing each other, with whichever finished last
  // popping in its own late 0.6s fade whenever it happened to land,
  // unrelated to which card was actually on screen at the time (reported
  // as a flicker that felt inconsistent/scroll-speed-dependent, because
  // it really was just network race position, not scroll position).
  // .event has no such override, so its geometry tracks real scroll
  // position the way rootMargin here assumes.
  // 600px -> 4000px (roughly 4-5 card-heights) by request: confirmed live
  // that fast scrolling can outrun a 600px head start entirely -- jumping
  // straight past the margin before the fetch+decode has any real time to
  // finish, landing on a card whose image request only just fired,
  // showing as a dark/blank frame until it catches up (scrolling back
  // over the same card again worked fine, since by then it was already
  // cached -- confirming this was a load-timing race, not a rendering
  // bug). Images are lightweight enough (see the fade-in transition's own
  // sizing) that loading more of them ahead of actual need isn't a real
  // cost the way it would be for video.
  const imgObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const section = entry.target;
          const img = section.querySelector(".event-media img");
          if (img && img.dataset.src && !img.src) {
            img.src = img.dataset.src;
            img.addEventListener("load", () => img.classList.add("loaded"));
          }
          obs.unobserve(section);
        }
      });
    },
    { rootMargin: "4000px 0px" }
  );
  document.querySelectorAll(".event").forEach((section) => imgObserver.observe(section));

  // eager-load the first couple of hero images
  document.querySelectorAll(".event-media img").forEach((img, idx) => {
    if (idx < 2) {
      img.src = img.dataset.src;
      img.addEventListener("load", () => img.classList.add("loaded"));
    }
  });

  // ---- only one video plays at a time, anywhere on the site ----
  // Every video card (site-wide now, not just one special-cased ID) uses
  // the same custom-controlled YT.Player -- see mountCustomPlayer below.
  // This tracker is what enforces "only one plays": whichever starts
  // playing pauses whatever was previously playing; scrolling the
  // currently-playing one's own card out of view also pauses it (see
  // observeVideoVisibility below), so nothing keeps playing quietly
  // off-screen either.
  let currentlyPlaying = null; // { pause(), player } or null
  function pauseCurrentlyPlaying() {
    currentlyPlaying?.pause();
    currentlyPlaying = null;
  }
  function setCurrentlyPlaying(entry) {
    if (currentlyPlaying === entry) return;
    pauseCurrentlyPlaying();
    currentlyPlaying = entry;
  }
  // Toggles ONE entry's play/pause state without touching currentlyPlaying
  // at all -- deliberately separate from pauseCurrentlyPlaying, which
  // NULLS the reference (correct for "something else took over" or
  // "scrolled off-screen," where the video genuinely stops being
  // relevant). A user-initiated pause (Space) is not that: the video is
  // still the one on screen, just paused, and needs to stay tracked so a
  // SECOND toggle (resume) has something to act on. This was a real,
  // confirmed bug: Space used to call pauseCurrentlyPlaying() directly,
  // which cleared currentlyPlaying on the very first pause -- the very
  // next Space press then found nothing tracked, silently skipped all
  // handling, and fell through to the browser's native "scroll down"
  // default, reading as "Space doesn't pause, it jumps to the next
  // slide" (exactly as reported).
  function toggleEntry(entry) {
    if (!entry) return;
    const state = entry.player.getPlayerState();
    if (state === 1) entry.player.pauseVideo();
    else entry.player.playVideo();
  }
  // Watches the .event SECTION (normal document flow, real scroll-based
  // geometry) rather than any position:fixed video layer itself, same
  // reasoning as everywhere else in this file that a fixed element can't
  // be observed this way (it's always "in the viewport" regardless of
  // scroll).
  //
  // Fully unmounts (not just pauses) the instant the card drops below the
  // 0.5 threshold, per explicit request: scrolling away should reset a
  // video to its untouched state, not remember a mid-playback timestamp
  // to resume from later. unmountVideoPlayer() already does exactly that
  // (destroy()s the real player and clears the mount flag), and scrolling
  // back to the card starts it again (see activateVideoFor) --
  // static image, then the video, from scratch,
  // same as a first-ever visit. Unconditional (not gated on this being
  // the currently-playing entry): a card that's merely mounted-but-paused
  // (toggled off before scrolling away) should reset just the same as one
  // that was actively playing.
  function observeVideoVisibility(section, entry) {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting || e.intersectionRatio <= 0.5) {
            // A retired one is deleted on its own schedule (see dropVideos).
            if (!entry.retired) unmountVideoPlayer(entry);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.5 }
    );
    obs.observe(section);
    return obs;
  }

  // ---- side rails ----
  // When the fitted 16:9 video leaves bars at least this wide at its sides,
  // the site's own UI moves into them (body.side-rails in style.css), clear
  // of YouTube's controls. Narrower windows keep the top bar.
  const RAIL_MIN_BAR = 96;
  function updateRailsLayout() {
    const bar = (innerWidth - Math.min(innerWidth, (innerHeight * 16) / 9)) / 2;
    document.body.classList.toggle("side-rails", bar >= RAIL_MIN_BAR);
  }
  updateRailsLayout();

  // ---- site-wide "hide UI" toggle ----
  // Hides the header (wordmark/counter), the year rail, the year
  // watermark, and the active card's own text panel -- everything
  // overlaid ON TOP of the image/video that isn't the video's own
  // controls -- for a clean, unobstructed view. This button and the
  // sound toggle deliberately stay OUT of the hidden set (they're the
  // only way back), which is why this toggles a class on <body> rather
  // than hiding .topbar-right wholesale.
  //
  // Three ways to drive it, all converging on the same setChromeHidden:
  //   - a plain click on the eye button itself: instant manual toggle,
  //     exactly as before. Also the universal escape hatch -- it clears
  //     whichever of the two modes below is active, so it always gets
  //     you back to a known, un-timed, visible state regardless of what
  //     was going on.
  //   - "1s" (the hover-revealed menu): idle-hide mode -- UI AND the
  //     mouse cursor both hide once the mouse rests for 1s, and both
  //     come back the instant it moves again. Mirrors the same
  //     auto-hide-on-idle convention fullscreen video players use.
  //   - "∞": always-hide mode -- hides immediately and just stays that
  //     way (no timer, cursor untouched) until the eye button itself is
  //     clicked.
  const chromeToggleBtn = document.getElementById("chrome-toggle");
  const chromeIconEye = chromeToggleBtn.querySelector(".icon-eye");
  const chromeIconEyeOff = chromeToggleBtn.querySelector(".icon-eye-off");
  const chromeModeBtns = document.querySelectorAll(".chrome-mode-btn");

  // "manual" | "always" | one of IDLE_DELAYS's own keys below.
  let chromeMode = "manual";
  // Every idle-hide duration on offer, in ms -- one .chrome-mode-btn
  // per key (matched by its data-mode). Adding another duration is just
  // one more entry here plus one more button in the HTML; nothing else
  // needs to know how many there are (see the generic membership checks
  // below instead of a hardcoded === "idle").
  const IDLE_DELAYS = { idle1: 1000, idle5: 5000, idle10: 10000 };
  // The eye button's OWN icon/pressed state is deliberately a different
  // question from "is the UI hidden at this exact instant" -- idle mode
  // starts out fully visible (nothing hides until the mouse actually
  // rests), but it's already ARMED the moment it's selected, and by
  // request that needs to read as "on" immediately, not only once the
  // 1s timer actually fires. Hidden-right-now OR a mode is armed, either
  // one lights up the eye.
  function updateChromeToggleVisual() {
    const on = chromeMode !== "manual" || document.body.classList.contains("chrome-hidden");
    chromeToggleBtn.setAttribute("aria-pressed", String(on));
    chromeToggleBtn.setAttribute("aria-label", on ? "Show site UI" : "Hide site UI");
    // classList, not the `hidden` property -- SVGSVGElement's `.hidden`
    // IDL property doesn't reflect to the real hidden CONTENT ATTRIBUTE
    // the way it does on ordinary HTML elements (confirmed live: leaves
    // hasAttribute('hidden') false), a real bug already hit once this
    // session. classList works identically on every element type.
    chromeIconEye.classList.toggle("icon-hidden", on);
    chromeIconEyeOff.classList.toggle("icon-hidden", !on);
  }
  function setChromeHidden(hidden) {
    document.body.classList.toggle("chrome-hidden", hidden);
    updateChromeToggleVisual();
  }

  let idleHideTimer = null;
  function armIdleHideTimer() {
    clearTimeout(idleHideTimer);
    idleHideTimer = setTimeout(() => {
      setChromeHidden(true);
      document.body.classList.add("cursor-hidden");
    }, IDLE_DELAYS[chromeMode]);
  }
  function setChromeMode(mode) {
    chromeMode = mode;
    try {
      localStorage.setItem("chromeMode", mode);
    } catch (e) {
      // Storage can throw (disabled, some private-browsing contexts) --
      // the mode still works for this visit, it just won't be
      // remembered next time.
    }
    clearTimeout(idleHideTimer);
    document.body.classList.remove("cursor-hidden");
    chromeModeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    if (mode in IDLE_DELAYS) {
      setChromeHidden(false); // starts visible; the timer hides it once the mouse actually rests
      armIdleHideTimer();
    } else if (mode === "always") {
      setChromeHidden(true);
    } else {
      updateChromeToggleVisual(); // manual mode has no hide/show side effect of its own
    }
  }

  // Hovering two specific zones -- the text panel and the year rail
  // (wired at each of their own creation points below) -- pauses
  // auto-hide entirely while it lasts, for every mode that has one. A
  // video's frame used to be a third, but it fills the whole screen, so
  // hovering it kept auto-hide paused the entire time a video was up.
  // Idle mode's own countdown only ever reset
  // on actual mouse MOVEMENT anywhere on the page; resting the cursor
  // (not moving it, just parked reading text or fine-adjusting a
  // slider) still counted as "idle" and hid the UI mid-interaction
  // without this. "always" mode has no countdown to pause -- it hides
  // immediately by design -- so this temporarily shows it instead,
  // reverting the instant the hover ends. No effect in "manual": that
  // mode's hidden/shown state is a deliberate, sticky choice nothing
  // else should disturb.
  // Also read by the site-wide mousemove listener further below -- the
  // browser's own hover state alone isn't enough to act on here, since
  // clearing the timer once on mouseenter doesn't keep it cleared: any
  // further mousemove at all (even the tiniest real-mouse jitter while
  // still sitting inside the same zone) would otherwise immediately
  // re-arm it again through that completely separate listener, which
  // has no way to know a hover zone is why the mouse just moved. This
  // flag is that missing link -- while true, that listener still shows
  // the UI (harmless, already visible) but skips the re-arm, leaving
  // the countdown genuinely paused for as long as the hover lasts,
  // confirmed live: without this exact fix, hovering the quote text in
  // 1s mode still hid everything within a few seconds regardless.
  let hoveringPauseZone = false;
  function pauseAutoHideForHover() {
    hoveringPauseZone = true;
    if (chromeMode === "manual") return;
    clearTimeout(idleHideTimer);
    document.body.classList.remove("cursor-hidden");
    if (document.body.classList.contains("chrome-hidden")) setChromeHidden(false);
  }
  function resumeAutoHideAfterHover() {
    hoveringPauseZone = false;
    if (chromeMode === "always") setChromeHidden(true);
    else if (chromeMode in IDLE_DELAYS) armIdleHideTimer();
  }
  yearRail.addEventListener("mouseenter", pauseAutoHideForHover);
  yearRail.addEventListener("mouseleave", resumeAutoHideAfterHover);

  // Restores whichever mode was last explicitly chosen (persisted just
  // above, inside setChromeMode) so a reload doesn't forget it. "idle1"
  // (1s) is the default for a genuinely first-time visitor with nothing
  // saved yet, by request -- everyone else keeps whatever they last
  // picked, "manual" (off) included. A stale "idle" from before the 5s/
  // 10s options existed just falls through to that same default, which
  // is the exact 1s behavior it used to mean anyway.
  function loadSavedChromeMode() {
    try {
      const saved = localStorage.getItem("chromeMode");
      if (saved === "always" || saved === "manual" || saved in IDLE_DELAYS) return saved;
    } catch (e) {
      // Falls through to the same first-time-visitor default below.
    }
    return "idle1";
  }
  setChromeMode(loadSavedChromeMode());

  chromeToggleBtn.addEventListener("click", () => {
    if (chromeMode !== "manual") {
      // A mode is on: one click switches the whole thing off -- the mode
      // AND the hiding -- by request. Toggling hidden here instead used to
      // hide the UI again (it's always showing by the time the mouse
      // reaches this button), leaving the eye lit after the mode was gone.
      setChromeMode("manual");
      setChromeHidden(false);
    } else {
      setChromeHidden(!document.body.classList.contains("chrome-hidden"));
    }
    chromeToggleBtn.blur(); // see the mode buttons' own comment for why
  });
  chromeModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (chromeMode === btn.dataset.mode) {
        // Re-clicking the already-active mode deselects it -- by
        // request, same "back to a known, visible state" the eye
        // button's own escape-hatch click already does.
        setChromeMode("manual");
        setChromeHidden(false);
      } else {
        setChromeMode(btn.dataset.mode);
      }
      // A real, confirmed bug otherwise: a mouse click leaves the
      // clicked button focused (an ordinary browser default), and
      // :focus-within (added below purely so a keyboard user tabbing to
      // a mode button can still see the menu before activating it) kept
      // the flyout open from that lingering focus alone, independent of
      // :hover -- it never closed even once the mouse had clearly moved
      // on elsewhere. Blurring right after a MOUSE click clears that
      // specific case while leaving genuine keyboard-tab focus (which
      // never runs through a click at all) untouched.
      btn.blur();
    });
  });

  // Site-wide, not scoped to the button/menu -- idle mode cares about the
  // mouse resting ANYWHERE on the page, not just over this one control.
  window.addEventListener("mousemove", () => {
    if (!(chromeMode in IDLE_DELAYS)) return;
    // This runs on every mouse move, so it only touches the page when
    // something is actually hidden -- redoing the class and attribute writes
    // each time showed up as extra style recalcs while the mouse moved.
    if (document.body.classList.contains("cursor-hidden")) document.body.classList.remove("cursor-hidden");
    if (document.body.classList.contains("chrome-hidden")) setChromeHidden(false);
    // Skipped while parked in one of the two pause zones (see
    // hoveringPauseZone's own comment) -- rearming here on every
    // stray pixel of movement is exactly what silently undid the
    // pause otherwise.
    if (!hoveringPauseZone) armIdleHideTimer();
  });

  // ---- site-wide "hide shadows" toggle ----
  // A SEPARATE concern from chrome-hidden above: this only strips the
  // dark gradient BACKDROPS (the top bar's own background, and every
  // video's own control-bar background) -- not the text/controls sitting
  // on top of them, which keep their own visibility logic untouched
  // either way.
  const shadowsToggleBtn = document.getElementById("shadows-toggle");
  const shadeIconOn = shadowsToggleBtn.querySelector(".icon-shade");
  const shadeIconOff = shadowsToggleBtn.querySelector(".icon-shade-off");
  function setShadowsHidden(hidden) {
    document.body.classList.toggle("shadows-hidden", hidden);
    shadowsToggleBtn.setAttribute("aria-pressed", String(hidden));
    shadowsToggleBtn.setAttribute("aria-label", hidden ? "Show dark gradient overlays" : "Hide dark gradient overlays");
    shadeIconOn.classList.toggle("icon-hidden", hidden);
    shadeIconOff.classList.toggle("icon-hidden", !hidden);
    try {
      localStorage.setItem("shadowsHidden", String(hidden));
    } catch (e) {
      // Storage can throw (disabled, some private-browsing contexts) --
      // the toggle still works for this visit, it just won't be
      // remembered next time.
    }
  }
  shadowsToggleBtn.addEventListener("click", () => {
    setShadowsHidden(!document.body.classList.contains("shadows-hidden"));
  });
  // Restores whatever was last picked, same reasoning as chromeMode
  // below -- defaults to visible (false) when nothing's saved yet,
  // matching the plain HTML default (aria-pressed="false").
  let savedShadowsHidden = false;
  try {
    savedShadowsHidden = localStorage.getItem("shadowsHidden") === "true";
  } catch (e) {
    // Falls through to the same not-hidden default.
  }
  setShadowsHidden(savedShadowsHidden);

  // ---- site-wide sound toggle ----
  // A real click anywhere on the page grants the browser's "sticky user
  // activation" for the rest of the page's lifetime -- confirmed directly
  // (a genuine click on an unrelated button, then a YouTube iframe created
  // afterward in a completely separate later step, still autoplayed with
  // sound; the volume icon showed unmuted). Clicking this button is that
  // gesture: it both flips the visible on/off state AND is what makes a
  // LATER, click-free autoplay-with-sound (Concept Trailer III) actually
  // work, rather than silently getting blocked.
  //
  // Defaults to on (matching the button's own aria-pressed="true" in the
  // HTML): the actual audio on page load is still entirely governed by
  // the browser's own autoplay policy regardless of this default (there's
  // no gesture yet at load time, so Concept Trailer III still falls back
  // to muted the same as before if reached before any click happens) --
  // this only changes the STATED intent so a later click-driven unmute
  // isn't needed just to reach the state the site should start in.
  const soundToggleBtn = document.getElementById("sound-toggle");
  let soundEnabled = true;
  const customPlayers = []; // YT.Player instances under custom control
  function setSoundEnabled(on) {
    soundEnabled = on;
    soundToggleBtn.setAttribute("aria-pressed", String(on));
    // Defensive: confirmed live crash otherwise (Uncaught TypeError:
    // player.mute is not a function), from a player pushed into
    // customPlayers before its postMessage API bridge to the iframe was
    // actually ready. The mountCustomPlayer race this could ride along
    // with is fixed separately (see its own comment), but guarding the
    // call itself means one still-initializing player can't crash every
    // OTHER already-working one in the same forEach pass.
    customPlayers.forEach((player) => {
      if (on) {
        if (typeof player.unMute === "function") player.unMute();
        // Re-asserted here, not just trusted to have stuck from whatever
        // it was last set to -- confirmed live: unMute() alone could
        // bring a player back audible at a level not matching where the
        // volume slider actually sits (e.g. dragged to 0, then muted and
        // re-enabled via this button). volumeLevel itself is declared
        // further down this same function, safe to reference here since
        // this function only ever RUNS after that line has executed.
        if (typeof player.setVolume === "function") player.setVolume(volumeLevel);
      } else if (typeof player.mute === "function") {
        player.mute();
      }
    });
  }
  soundToggleBtn.addEventListener("click", () => setSoundEnabled(!soundEnabled));

  // Volume level (0-100), independent of the mute toggle above -- same
  // relationship a normal media player keeps between its mute button and
  // its volume slider (dragging to 0 doesn't flip the mute flag, and
  // muting doesn't move the slider). Revealed on hover via
  // .sound-toggle-wrap/.sound-toggle-menu, the same pattern as the
  // chrome-toggle mode picker (see that CSS block's own comments).
  const volumeSlider = document.getElementById("volume-slider");
  let volumeLevel = 100;
  function setVolumeLevel(v) {
    volumeLevel = v;
    try {
      localStorage.setItem("volumeLevel", String(v));
    } catch (e) {
      // Storage can throw (disabled, some private-browsing contexts) --
      // the level still applies for this visit, it just won't be
      // remembered next time.
    }
    customPlayers.forEach((player) => {
      if (typeof player.setVolume === "function") player.setVolume(v);
    });
  }
  volumeSlider.addEventListener("input", () => setVolumeLevel(Number(volumeSlider.value)));
  // Restores whatever level was last set, same reasoning as chromeMode
  // below -- defaults to 100 (full) when nothing's saved yet, matching
  // the slider's own HTML default.
  (function loadSavedVolumeLevel() {
    let saved = 100;
    try {
      const stored = Number(localStorage.getItem("volumeLevel"));
      if (Number.isFinite(stored) && stored >= 0 && stored <= 100) saved = stored;
    } catch (e) {
      // Falls through to the same full-volume default.
    }
    volumeSlider.value = String(saved);
    setVolumeLevel(saved);
  })();
  // Dragging/clicking the slider leaves it focused (needed so arrow keys
  // can keep nudging it afterward) -- same :focus-within-outlives-:hover
  // gap the chrome-toggle mode buttons had, but blurring on every
  // interaction like those buttons do would kill that keyboard follow-up
  // here. Blurring on mouseleave instead only closes it once the cursor
  // actually leaves.
  //
  // That alone isn't enough, though -- confirmed live: after an actual
  // click-drag on the slider that's released outside the wrap (as
  // opposed to a plain hover-and-leave), the blur still happens, but
  // .sound-toggle-menu's own opacity stays stuck at 1 even though
  // neither :hover nor :focus-within matches by every measure checked
  // (matches(':hover'), the live :hover chain, activeElement). Rather
  // than chase why that one gesture leaves the rendered style stale,
  // .force-hide is an explicit, unconditional close that doesn't depend
  // on the browser re-deriving :hover/:focus-within correctly -- added
  // on mouseleave same as the blur, cleared the moment a real hover or
  // keyboard focus re-enters so normal use is unaffected.
  const soundToggleWrap = document.querySelector(".sound-toggle-wrap");
  const soundToggleMenu = document.querySelector(".sound-toggle-menu");
  soundToggleWrap.addEventListener("mouseleave", () => {
    volumeSlider.blur();
    soundToggleMenu.classList.add("force-hide");
  });
  soundToggleWrap.addEventListener("mouseenter", () => soundToggleMenu.classList.remove("force-hide"));
  soundToggleWrap.addEventListener("focusin", () => soundToggleMenu.classList.remove("force-hide"));

  // Pressing Space is the browser's native "scroll down ~one page"
  // shortcut -- with every card sized min-height:100vh, that lands
  // roughly on the next card, reading as "space jumps to the next event."
  // Reasonable default, but not while something's actually playing: in
  // that case Space toggling the video is the more useful, expected
  // behavior (matches YouTube's own site), so the native scroll is
  // suppressed specifically for that one case. Left alone (no
  // preventDefault) when a focused element would normally use Space
  // itself (a button's own activate-on-space).
  //
  // Calls toggleEntry, NOT pauseCurrentlyPlaying -- a real, confirmed bug
  // when this called pauseCurrentlyPlaying directly: that function NULLS
  // currentlyPlaying (correct for "something else took over" or
  // "scrolled off-screen," but not for "the user just paused it and
  // wants to resume"). The first Space press paused correctly, but wiped
  // the tracked reference doing it -- the very next Space press then
  // found nothing tracked, skipped all handling, and fell through to the
  // native scroll-down default. Read exactly as reported: "doesn't
  // pause/unpause, just jumps to the next slide."
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !currentlyPlaying) return;
    const active = document.activeElement;
    const tag = active?.tagName;
    if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) return;
    e.preventDefault();
    toggleEntry(currentlyPlaying);
  });

  // ---- custom-controlled autoplay video (Concept Trailer III only) ----
  // Loads the real YouTube JS IFrame Player API (youtube.com/iframe_api),
  // NOT the plain-iframe pattern every other video card uses above --
  // deliberately, so this one card can have its own play/pause + seek bar
  // styled to match the site instead of YouTube's native red/white
  // control bar. That script is exactly what the plain-iframe approach
  // was chosen to avoid elsewhere (ad blockers/privacy shields commonly
  // block it outright) -- accepted here specifically, for this one video,
  // in exchange for controls that actually look like they belong on this
  // site. Loaded once and cached, however many custom players end up
  // using it.
  let ytApiPromise = null;
  function loadYoutubeApi() {
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevReady?.();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      // Dynamically-created scripts are already async by default (unlike
      // a plain <script> tag in the HTML), so this doesn't change actual
      // behavior -- set explicitly anyway so that's true by design, not
      // by an easy-to-miss browser default someone could break later by
      // switching to a static tag.
      script.async = true;
      document.head.appendChild(script);
    });
    return ytApiPromise;
  }

  // A cover-the-whole-frame trick (hideNativeFeedback) used to live here,
  // briefly hiding the video to mask YouTube's native center play/pause
  // icon flash on every state change. Removed per explicit request -- the
  // cover's own fade in/out read as two flickers of its own, arguably
  // worse than just eating YouTube's one native icon flash. See
  // git history if it's worth revisiting.

  // A whole custom control bar (play/pause, seek track, CC toggle, its
  // own shades-auto-hide toggle) plus a click-catcher overlay (to stop a
  // direct iframe click from triggering YouTube's own native play/pause
  // flash under playerVars.controls:0) used to live here. Removed per
  // explicit request in favor of YouTube's own native bar (controls:1
  // below) -- matching how sites like TED embed theirs, and getting
  // idle-fade, captions, quality selection, and scrubbing for free
  // instead of reimplementing each. A viewport-anchored fallback seek
  // bar (papering over native's own bar going partially off-screen on a
  // narrow window) lived here after that, in turn removed now that
  // .yt-frame iframe fits by contain instead of cropping -- native's own
  // bar can no longer go off-screen in the first place. A rotate-to-
  // landscape button lived here after THAT -- removed too, both because
  // a phone that actually needs it already has a real, built-in way to
  // rotate (no button required), and because it rode along into
  // fullscreen when clicked (a sibling of the iframe within the SAME
  // .yt-frame that requestFullscreen() targeted), sitting there uselessly
  // once nothing was left for it to do. See git history for any of the
  // three full versions.
  //
  // What's left for a narrow/portrait window: contain-fit already shows
  // the complete, fully-interactive video (letterboxed, not cropped) --
  // nothing else needed.

  // ---- "burn" reveal: static image -> video, via an organic noise mask ----
  // Disabled for now (the call site in mountCustomPlayer's onReady is
  // commented out) -- shelved per explicit request to get the underlying
  // player mechanics solid first, before layering visual polish back on.
  // Left defined, not deleted, so it's a one-line change to bring back.
  // Inspired by the dissolve/burn transitions at effects-burn.framer.website
  // (a WebGL/canvas effect there -- no plain <img> in its DOM at all,
  // confirmed by inspection -- so this is an original CSS/SVG approximation
  // of the same visual idea, not a copy of their implementation, which
  // isn't accessible anyway). An SVG feTurbulence filter generates organic
  // noise; feComponentTransfer thresholds it into a hard-edged mask;
  // animating that threshold over the reveal duration grows torn,
  // irregular-edged holes through which the video (already sitting above
  // the still image in stacking order) becomes visible, rather than a
  // uniform wipe or fade. The video already covers the whole frame once
  // fully revealed, so the still image underneath needs no fade of its
  // own -- only the video's own mask needs to animate.
  //
  // Each call builds its OWN filter/mask with a unique id rather than
  // sharing one: this can run on more than one video mounting in close
  // succession (fast scrolling past several PV cards), and two reveals
  // both writing to a single shared threshold attribute would fight each
  // other. The small SVG fragment is removed again once the reveal
  // finishes, along with the mask reference itself, so a fully-revealed
  // video is in exactly the same DOM/style state as if it had never been
  // masked at all.
  let burnMaskCounter = 0;
  function playBurnReveal(targetEl, durationMs) {
    const id = `burn-${burnMaskCounter++}`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.innerHTML = `
      <defs>
        <filter id="${id}-noise" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" seed="${Math.floor(Math.random() * 1000)}" result="noise"/>
          <feColorMatrix in="noise" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="noiseAlpha"/>
          <feComponentTransfer in="noiseAlpha">
            <feFuncA id="${id}-func" type="linear" slope="25" intercept="-11"/>
          </feComponentTransfer>
        </filter>
        <mask id="${id}-mask" maskUnits="objectBoundingBox">
          <rect width="100%" height="100%" filter="url(#${id}-noise)" fill="#fff"/>
        </mask>
      </defs>
    `;
    document.body.appendChild(svg);
    targetEl.style.mask = `url(#${id}-mask)`;
    targetEl.style.webkitMask = `url(#${id}-mask)`;

    const func = svg.querySelector(`#${id}-func`);
    // slope=25 stays fixed; intercept is what actually sweeps the
    // threshold. At -11 even the noise's brightest points fall below the
    // alpha cutoff (fully masked); at 14 even its darkest points clear it
    // (fully revealed) -- found by testing against the same slope in a
    // standalone prototype before wiring this in.
    const START = -11;
    const END = 14;
    const t0 = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      func.setAttribute("intercept", (START + (END - START) * eased).toFixed(3));
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        targetEl.style.mask = "";
        targetEl.style.webkitMask = "";
        svg.remove();
      }
    }
    requestAnimationFrame(tick);
  }

  // ---- video frame: static image -> video, instant swap ----
  // Hidden from before its iframe exists until YouTube is actually PLAYING
  // (see revealEntry): until then it only has black unstarted/buffering
  // frames to show -- measured ~0.5s of them after onReady. Opacity rather
  // than visibility:hidden, so the iframe is still a rendered, on-screen
  // frame while it loads.
  function hideVideoFrame(el) {
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
  }
  // Reveals anyway if playback never starts (e.g. autoplay blocked), so the
  // frame can't stay invisible with YouTube's own play button hidden under it.
  const VIDEO_REVEAL_FALLBACK = 3000;
  // Interactive the moment it's visible, under a barrier that steps aside as
  // soon as the mouse moves across the video (see addVideoShield). A wheel
  // that does reach the iframe still scrolls the page, and onScrollFrame
  // feeds that to the reel -- the player that scroll is going to mustn't be
  // deleted mid-scroll, though (see dropVideos).
  function showVideoFrame(el) {
    el.style.opacity = "";
    el.style.pointerEvents = "auto";
  }

  // ---- scroll barrier over the video ----
  // A wheel over YouTube's iframe goes to YouTube first and only reaches the
  // reel second-hand, as the page scroll YouTube passes on (onScrollFrame) --
  // later and lumpier than a key press. A wheel gets used with the mouse at
  // rest, though, and YouTube with the mouse moving, so a transparent
  // .yt-shield over the iframe keeps the wheel on this page until the mouse
  // actually moves across the video (or clicks it), then hands YouTube its
  // hover controls and clicks as usual. Every new card's player starts with
  // a fresh one, and the mouse leaving the video puts it back. It inherits
  // the holder's pointer-events, so it only catches anything once the video
  // is showing.
  const SHIELD_MOVE_PX = 8;
  function armShield(shield) {
    shield.hidden = false;
    shield._lastX = null;
    shield._moved = 0;
  }
  function addVideoShield(holder) {
    const shield = document.createElement("div");
    shield.className = "yt-shield";
    armShield(shield);
    shield.addEventListener("mousemove", (e) => {
      // Moving while the roulette covers the video isn't reaching for it.
      if (reelZoomT > 0) return armShield(shield);
      // Measured from positions rather than movementX, so every kind of
      // mouse input counts the same.
      if (shield._lastX !== null) {
        shield._moved += Math.abs(e.clientX - shield._lastX) + Math.abs(e.clientY - shield._lastY);
      }
      shield._lastX = e.clientX;
      shield._lastY = e.clientY;
      if (shield._moved >= SHIELD_MOVE_PX) shield.hidden = true;
    });
    shield.addEventListener("click", () => { shield.hidden = true; });
    holder._shield = shield;
    if (!holder._shieldRearms) {
      holder._shieldRearms = true;
      // Over the bars beside the video, the mouse has left it.
      holder.addEventListener("mousemove", (e) => {
        if (e.target === holder && holder._shield && holder._shield.hidden) armShield(holder._shield);
      });
    }
    holder.appendChild(shield);
  }

  // ---- cap how many players stay mounted at once ----
  // Every mounted player is a real YouTube iframe -- a full embedded page,
  // not a cheap DOM node -- and nothing was ever destroying old ones as
  // the visitor scrolled past ("only one plays" only ever paused them).
  // Across 126 potential videos in one long scroll, that meant every
  // single one ever visited stayed alive in memory for the rest of the
  // session (confirmed live: the tab reached 2.8GB). This keeps only the
  // most recently mounted MAX_MOUNTED_VIDEOS around, destroying the
  // oldest beyond that the moment a new one mounts -- an evicted card
  // just reverts to its static image, and re-mounts normally if scrolled
  // back to later, same as if it had never been visited.
  // Lowered from 3 to 0 by request, alongside removing the preload
  // observer entirely (see below) -- confirmed live via 1.4GB Chrome
  // memory usage that 3 real concurrent YouTube iframes (each one is
  // basically its own heavy webpage, video decoder included) is a real
  // cost, and preloading 1-2 videos ahead on top of the active one meant
  // that cap was commonly sitting at its full 3 during ordinary scrolling.
  // At 0, only ever the currently-active video (which enforceMountCap
  // always protects regardless of this number -- see its own comment)
  // stays mounted; nothing preloads ahead of it anymore. Trades away the
  // instant/stall-free reveal preloading bought -- a video now waits on
  // its own load far more often, since there's no more head start.
  const MAX_MOUNTED_VIDEOS = 0;
  const mountedQueue = []; // entries, oldest first
  // Holder -> entry, so a holder that's already preloading (see
  // mountCustomPlayer/requestActivate below) can be looked up and
  // activated later without creating a second player for it.
  const entryByHolder = new Map();

  function unmountVideoPlayer(entry) {
    // Already gone -- e.g. dropped by the reel before its own visibility
    // observer fired.
    if (entryByHolder.get(entry.holder) !== entry) return;
    const qIdx = mountedQueue.indexOf(entry);
    if (qIdx !== -1) mountedQueue.splice(qIdx, 1);
    if (currentlyPlaying === entry) currentlyPlaying = null;
    const pIdx = customPlayers.indexOf(entry.player);
    if (pIdx !== -1) customPlayers.splice(pIdx, 1);
    entry.player.destroy(); // YT.Player's own teardown -- removes its iframe
    entry.holder.innerHTML = ""; // drop the custom controls too
    delete entry.holder.dataset.customMounted;
    delete entry.holder._wantsActivate;
    entryByHolder.delete(entry.holder);
    // Back to its never-mounted resting state (inline styles aren't
    // cleared by the innerHTML reset above).
    hideVideoFrame(entry.holder);
    // Move the holder back home -- see mountCustomPlayer's own comment
    // for why it left in the first place. Harmless to skip if somehow
    // already home (falsy _homeParent) or mid-relocation elsewhere.
    if (entry.holder._homeParent) entry.holder._homeParent.appendChild(entry.holder);
    syncVideoSlotVisibility();
  }

  function enforceMountCap() {
    while (mountedQueue.length > MAX_MOUNTED_VIDEOS) {
      // Skip the currently-playing one even if it's the oldest in the
      // queue -- shouldn't normally happen (scrolling to a new card
      // pauses whatever was playing before it), but never yank the video
      // literally in front of the visitor out from under them. Also skip
      // the NEWEST entry -- enforceMountCap() runs right after that one
      // is pushed, BEFORE its own requestActivate() call (its
      // entry.activated isn't true yet at that exact point, even for a
      // card mounting specifically to be shown immediately), so without
      // this a plain !e.activated check let this evict the entry a
      // caller was about to activate on the very next line, destroying
      // its player before it ever got to play.
      //
      // This used to check a persistent _wantsActivate flag instead of
      // "is this the newest" -- a real, confirmed, MUCH worse bug: that
      // flag is set once and never cleared, so it wasn't protecting "the
      // entry about to activate," it was permanently exempting ANY
      // holder that had ever once wanted to activate, forever. Fast
      // scrolling fires many cards' 300ms-delayed activation in quick
      // succession, each permanently immune the instant it started
      // mounting -- confirmed live as literally all 126 videos mounted
      // simultaneously, real iframes and all, after one fast scroll
      // session (also the actual cause of the reported "stuck mid-
      // blinds": dozens of reveals running at once, competing for the
      // same holders). "Newest" is recomputed fresh on every call
      // instead, so it only ever protects the one entry actually at risk
      // right now, never lingering once it's no longer that.
      const newest = mountedQueue[mountedQueue.length - 1];
      const target = mountedQueue.find(
        (e) => e !== currentlyPlaying && e !== newest && !e.activated
      );
      if (!target) break;
      unmountVideoPlayer(target);
    }
  }

  // ---- the reel deletes the video it leaves ----
  // Runs as soon as the roulette covers the screen on a card change (see
  // reelFrame), so no player outlives its card -- except one already shown,
  // since the mouse could reach it: a scroll that starts over a player keeps
  // being delivered to that player until the wheel rests (the browser
  // latches it there, roughly half a second), so deleting it mid-scroll
  // drops the rest of that scroll -- the likely cause of the scroll lock
  // that embeds on other sites never hit, since nothing deletes their
  // player. A shown one is hidden and stopped instead (retireEntry), still
  // passing its scroll through to the page, and deleted once scrolling has
  // stopped long enough.
  const VIDEO_SCROLL_HOLD_MS = 700;
  let retiredTimer = null;
  function dropVideos() {
    let retired = false;
    for (const entry of [...mountedQueue]) {
      if (entry.revealed) {
        retireEntry(entry);
        retired = true;
      } else {
        unmountVideoPlayer(entry);
      }
    }
    // A mount still waiting on the YouTube API script has no entry yet.
    for (const holder of [...videoSlot.querySelectorAll(".yt-frame")]) {
      if (entryByHolder.has(holder)) continue;
      holder._mountToken = (holder._mountToken || 0) + 1;
      delete holder.dataset.customMounted;
      delete holder._wantsActivate;
      hideVideoFrame(holder);
      if (holder._homeParent) holder._homeParent.appendChild(holder);
    }
    syncVideoSlotVisibility();
    if (retired) {
      clearTimeout(retiredTimer);
      retiredTimer = setTimeout(deleteRetiredVideos, VIDEO_SCROLL_HOLD_MS);
    }
  }
  function retireEntry(entry) {
    entry.retired = true;
    const qIdx = mountedQueue.indexOf(entry);
    if (qIdx !== -1) mountedQueue.splice(qIdx, 1);
    const pIdx = customPlayers.indexOf(entry.player);
    if (pIdx !== -1) customPlayers.splice(pIdx, 1); // out of the sound toggle's reach
    if (currentlyPlaying === entry) currentlyPlaying = null;
    delete entry.holder._wantsActivate;
    // Stopped, not just muted: one still playing in the background while the
    // next card's player started up left every third new video stuck
    // buffering at 0:00 when flipping between two cards.
    if (typeof entry.player.stopVideo === "function") entry.player.stopVideo();
    hideVideoFrame(entry.holder);
  }
  function deleteRetiredVideos() {
    const quiet = performance.now() - reelLastInput;
    if (quiet < VIDEO_SCROLL_HOLD_MS) {
      retiredTimer = setTimeout(deleteRetiredVideos, VIDEO_SCROLL_HOLD_MS - quiet);
      return;
    }
    for (const entry of [...entryByHolder.values()]) if (entry.retired) unmountVideoPlayer(entry);
  }

  // Splits "load the player" from "actually show and play it" -- lets a
  // video start its real, slow part (the YouTube iframe/JS load) well
  // before the card is the active one (see the wider-margin preload
  // observer below), so that by the time it DOES become active, there's
  // often nothing left to wait on at all.
  //
  // requestActivate() is what a card becoming genuinely active always
  // calls: once the player is ready, engagePlayer() starts playback and
  // shows the frame -- right away if it's already ready, otherwise via
  // onReady's own wantsActivate check below. entry.activated guards
  // against doing that twice, since this can legitimately be called more
  // than once for the same entry (see the activation observer).
  function requestActivate(entry) {
    entry.holder._wantsActivate = true;
    if (entry.ready) engagePlayer(entry);
  }
  function engagePlayer(entry) {
    if (entry.activated) return;
    entry.activated = true;
    // Seeks back to the real starting point rather than trusting wherever
    // playback happens to be -- see onReady's own comment for why it's
    // not necessarily still sitting at 0: native autoplay (always
    // muted -- the only reliable way to guarantee it plays at all, see
    // playerVars below) starts the instant the player's ready, whether or
    // not this entry has actually been shown yet, so a video that spent a
    // while preloading unseen could otherwise reveal already partway
    // through instead of starting fresh.
    const { ytStart } = entry.holder.dataset;
    entry.player.seekTo(ytStart ? Number(ytStart) : 0, true);
    // Once the page has had a click or key press, a browser allows playback
    // with sound, so the video starts unmuted and narration that begins at
    // 0:00 isn't clipped. Before that (a wheel doesn't count) it starts
    // muted, the one kind of start a browser never refuses, and applySound
    // tries for sound once the video is really playing. Asking for sound
    // without that permission, even straight after playVideo(), raced the
    // start: both calls reach YouTube only as messages, so whenever the video
    // wasn't already running when the unmute landed, the start itself became
    // playback with sound -- refused, leaving YouTube's untouched thumbnail
    // and play button on screen (confirmed live: "sometimes it doesn't
    // autoplay at all").
    if (soundEnabled && hadUserActivation()) {
      entry.player.unMute();
      entry.soundApplied = true;
    } else {
      entry.player.mute();
    }
    entry.player.playVideo();
    if (typeof entry.player.setVolume === "function") entry.player.setVolume(volumeLevel);
    setTimeout(() => revealEntry(entry), VIDEO_REVEAL_FALLBACK);
    // Only now does a scroll-out mean anything to reset -- a preload that
    // never got shown just sits in mountedQueue until the cap reclaims
    // it (see enforceMountCap), same as it always could.
    //
    // entry.holder.closest(".event") NO LONGER finds it -- a real,
    // confirmed bug once the holder started physically relocating into
    // #video-slot while mounted (see mountCustomPlayer's own comment):
    // .closest() only walks the holder's CURRENT ancestors, and
    // #video-slot sits outside #events entirely. .homeParent (the
    // .event-media it was moved OUT of) never moves, so climbing from
    // there instead still reaches the right section either way.
    observeVideoVisibility(entry.holder._homeParent.closest(".event"), entry);
  }
  // ---- sound, once a video is really playing ----
  // Without a click or key press on the page yet, engagePlayer starts a video
  // muted; this turns the sound on at its first PLAYING. A browser that still won't allow sound (no click or key
  // press on the page yet) answers the unmute by pausing the video, which
  // soundRefused catches: the video carries on muted, and the next click or
  // key press anywhere brings the sound in (soundOnGesture). With no click or
  // key press yet, a pause that soon after can't have been the viewer's own.
  const SOUND_REFUSAL_WINDOW_MS = 1500;
  let soundAwaitsGesture = false;
  // Whether this page has had a click or key press since it loaded, the
  // permission a browser wants before playback with sound. A click inside a
  // YouTube frame counts too: activation reaches the frames above it.
  const hadUserActivation = () => !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  function applySound(entry) {
    if (entry.soundApplied) return;
    entry.soundApplied = true;
    if (!soundEnabled) return;
    entry.player.unMute();
    if (typeof entry.player.setVolume === "function") entry.player.setVolume(volumeLevel);
    entry.unmutedAt = performance.now();
  }
  function soundRefused(entry) {
    if (!entry.unmutedAt || performance.now() - entry.unmutedAt > SOUND_REFUSAL_WINDOW_MS) return;
    if (!navigator.userActivation || hadUserActivation()) return;
    entry.unmutedAt = 0;
    soundAwaitsGesture = true;
    entry.player.mute();
    // Asking to play from inside the pause notification itself, while
    // YouTube is still finishing that pause, got ignored in testing; a
    // moment later it resumes. Asked once more if it still hasn't.
    const live = () => !entry.retired && entryByHolder.get(entry.holder) === entry;
    setTimeout(() => {
      if (!live()) return;
      entry.player.playVideo();
      setTimeout(() => {
        if (live() && ![1, 3].includes(entry.player.getPlayerState())) entry.player.playVideo();
      }, 800);
    }, 200);
  }
  function soundOnGesture() {
    if (!soundAwaitsGesture) return;
    soundAwaitsGesture = false;
    if (!soundEnabled || !currentlyPlaying) return;
    currentlyPlaying.player.unMute();
    if (typeof currentlyPlaying.player.setVolume === "function") currentlyPlaying.player.setVolume(volumeLevel);
  }
  window.addEventListener("pointerdown", soundOnGesture, true);
  window.addEventListener("keydown", soundOnGesture, true);

  // Called on first PLAYING and by engagePlayer's fallback timer, whichever
  // comes first. Both can arrive after this entry was unmounted -- possibly
  // with its holder already remounted for another video -- so it only acts
  // while it's still the live entry for that holder.
  function revealEntry(entry) {
    if (entry.revealed || entry.retired || entryByHolder.get(entry.holder) !== entry) return;
    entry.revealed = true;
    showVideoFrame(entry.holder);
  }

  async function mountCustomPlayer(holder, activateImmediately) {
    if (holder.dataset.customMounted) return;
    holder.dataset.customMounted = "1";
    // A real, confirmed bug otherwise: clicks on the native player
    // (controls:1 below) silently did nothing -- not an automation
    // artifact, reproduced with a real mouse. Root cause, isolated by
    // testing the exact same iframe reparented to a few different
    // spots: document.elementFromPoint (and, it turns out, real click
    // dispatch along with it) resolved to .event-media -- the iframe's
    // own GRANDPARENT -- instead of the iframe itself, specifically
    // when that iframe sat nested inside one of the 131 stacked,
    // always-present position:fixed .event-media elements every event
    // pre-renders. Reparenting the very same holder to a plain,
    // un-duplicated position:fixed element elsewhere in the DOM (no
    // other change) made hit-testing resolve correctly every time --
    // so the holder physically moves into the single shared #video-slot
    // (see its own comment in style.css) for as long as it's actually
    // mounted, and moves back home in unmountVideoPlayer once it isn't.
    // Stored on the holder itself since, once moved, it's no longer
    // reachable via a plain .closest() from its original spot.
    holder._homeParent = holder._homeParent || holder.parentElement;
    videoSlot.appendChild(holder);
    syncVideoSlotVisibility();
    // A real, confirmed bug otherwise: dataset.customMounted alone can't
    // tell THIS call apart from a LATER one for the same holder. Speeding
    // down then back up fast enough unmounts a holder (clearing the
    // flag) and re-mounts it again (setting it right back to "1") while
    // the FIRST call is still sitting in the `await` below -- that first
    // call's own bail-out check then sees the flag as truthy again (set
    // by the second call) and wrongly proceeds, building a second,
    // never-tracked YT.Player for the same holder. That orphan never
    // gets destroy()'d (nothing references it to unmount later), so its
    // own internal postMessage polling runs forever (confirmed live:
    // thousands of failed postMessage warnings tracing back to this
    // function), and it can leave customPlayers holding a reference
    // whose mute()/unMute() aren't callable, crashing the sound toggle.
    // A per-holder token makes a call verifiably tell whether it's still
    // the current one after the await, not just whether SOME mount is
    // active.
    const myToken = (holder._mountToken = (holder._mountToken || 0) + 1);
    // Before anything else -- see hideVideoFrame for why this can't wait.
    hideVideoFrame(holder);
    if (activateImmediately) holder._wantsActivate = true;
    const { ytId, ytStart } = holder.dataset;
    const YT = await loadYoutubeApi();
    // A card can scroll out and get evicted (or unmount and remount)
    // while the API script itself is still loading (real network time)
    // -- if so, just bail rather than mounting a player into a holder
    // nobody's watching anymore, or duplicating one a newer call is
    // already building.
    if (holder._mountToken !== myToken) return;

    const playerEl = document.createElement("div");
    holder.appendChild(playerEl);
    addVideoShield(holder); // after playerEl, so it stays over the iframe YT.Player swaps in for it

    const player = new YT.Player(playerEl, {
      videoId: ytId,
      playerVars: {
        // Real, confirmed bug with the earlier autoplay:0 + explicit
        // playVideo() approach: a script-invoked playVideo() call is held
        // to a STRICTER browser autoplay policy than the native autoplay
        // attribute/playerVar is -- it silently failed to actually play
        // at all in normal use ("this disables our autoplay"). Native
        // autoplay is unconditionally reliable ONLY when muted (the one
        // browser-autoplay exception that's always allowed, regardless of
        // any user gesture/activation state), so mute is hardcoded true
        // here rather than following soundEnabled -- this can construct
        // well before the card is active (see the preload observer
        // below), and must never be heard before it's genuinely shown.
        // onReady immediately pauses it again (see below) so a
        // still-preloading video doesn't silently keep playing ahead
        // unseen; engagePlayer() is what actually resumes it (seeking
        // back to the start first) and sets the real mute state once the
        // card is genuinely active.
        autoplay: 1,
        controls: 1,
        mute: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        // Still disabled even with the native bar now visible: focusing
        // the iframe (e.g. clicking its own play button) would otherwise
        // let YouTube's OWN keyboard handling intercept Space/arrows --
        // keyboard events that land inside a focused iframe never reach
        // the page's own window listener at all, which would silently
        // break the existing Space-to-toggle feature (see toggleEntry)
        // the instant a viewer touched the native controls directly.
        disablekb: 1,
        start: ytStart ? Number(ytStart) : undefined,
      },
      events: {
        onReady: (e) => {
          // holder.closest(".event-media") stopped finding it the same
          // way observeVideoVisibility's own lookup did (see its
          // comment) -- _homeParent IS the .event-media, no .closest()
          // needed at all once relocation is accounted for.
          holder._homeParent?.classList.add("video-ready");
          entry.ready = true;
          // A real, confirmed bug in unconditionally pausing here (as
          // this used to do) before checking _wantsActivate: native
          // autoplay (the autoplay:1 playerVar above) is a separate,
          // browser-driven trigger that doesn't necessarily land at
          // exactly the same moment onReady fires -- pausing immediately
          // and then, on the very next line, having engagePlayer()
          // script a fresh playVideo() raced against that still-pending
          // native autoplay actually kicking in. Non-deterministic by
          // nature, so it surfaced as intermittent: mostly fine, then a
          // scrolled-to card would silently sit on YouTube's own paused
          // thumbnail instead of playing. Preloading (the only real
          // reason a freshly-onReady'd video would ever NOT want to
          // activate immediately) is gone from this codebase now, so
          // _wantsActivate is essentially always already true here in
          // practice -- only pause in the one case that still means
          // something (a genuine future preload), leaving the far more
          // common activate-now path to just ride the native autoplay
          // straight through instead of interrupting it.
          if (holder._wantsActivate) {
            engagePlayer(entry);
          } else {
            e.target.pauseVideo();
          }
        },
        onStateChange: (e) => {
          // A retired player is stopped, but a PLAYING from just before that
          // can still arrive -- it mustn't take over from the one on screen.
          if (e.data === 1 && !entry.retired) { // PLAYING
            setCurrentlyPlaying(entry);
            if (entry.activated) {
              applySound(entry);
              revealEntry(entry);
            }
          } else if (e.data === 2 && !entry.retired) { // PAUSED
            soundRefused(entry);
          }
        },
      },
    });
    const entry = {
      holder, player,
      pause: () => player.pauseVideo(),
      ready: false, activated: false, revealed: false,
    };
    entryByHolder.set(holder, entry);
    customPlayers.push(player);
    mountedQueue.push(entry);
    enforceMountCap();
    // Checks the LIVE flag, not just the activateImmediately parameter
    // this particular call got: the activation observer can fire (and
    // set holder._wantsActivate itself, via its own "entry not found yet"
    // fallback) at any point during the `await` above, for a call that
    // started out as activateImmediately=false.
    if (activateImmediately || holder._wantsActivate) requestActivate(entry);
  }

  // YouTube names its player iframe after the video through the title
  // attribute, which the browser also shows as a tooltip -- confirmed
  // popping up over the video on entering and leaving fullscreen, when the
  // browser re-checks what sits under a cursor that hasn't moved. The name
  // moves to aria-label instead (the same accessible name, no tooltip),
  // every time YouTube sets it.
  function untitleVideoFrames(holder) {
    const move = () => {
      for (const iframe of holder.querySelectorAll("iframe[title]")) {
        iframe.setAttribute("aria-label", iframe.getAttribute("title"));
        iframe.removeAttribute("title");
      }
    };
    new MutationObserver(move).observe(holder, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
  }

  document.querySelectorAll(".yt-frame[data-yt-id]").forEach((holder) => {
    untitleVideoFrames(holder);
    const section = holder.closest(".event");
    // A stable back-reference, captured once here while the holder is
    // still sitting in its original spot -- switchTagVariant's own
    // section.querySelector(".yt-frame") stopped finding it the same
    // way observeVideoVisibility's lookup did (see that one's own
    // comment): once mounted, the holder physically relocates into
    // #video-slot, outside this section entirely.
    section._videoHolder = holder;
  });

  // ---- year watermark: slot-machine digit roll on actual year change ----
  // Renders newStr into el one digit per slot; each digit that differs from
  // oldStr slides up from the old value to the new one (.year-digit and
  // .digit-roll in style.css). Also used by the roulette caption's year.
  function rollDigits(el, newStr, oldStr) {
    el.innerHTML = "";
    for (let i = 0; i < newStr.length; i++) {
      const oldChar = oldStr[i] ?? newStr[i];
      const newChar = newStr[i];
      const slot = document.createElement("span");
      slot.className = "year-digit";
      if (oldChar === newChar) {
        slot.textContent = newChar;
      } else {
        slot.innerHTML = `<span class="digit-roll"><span class="d-old">${oldChar}</span><span class="d-new">${newChar}</span></span>`;
      }
      el.appendChild(slot);
    }
    requestAnimationFrame(() => {
      el.querySelectorAll(".digit-roll").forEach((r) => r.classList.add("rolling"));
    });
  }

  const yearWatermarkEl = document.getElementById("year-watermark");
  let shownYear = null;
  function renderYearWatermark(newYear) {
    const newStr = String(newYear);
    const isFirstRender = shownYear === null;
    const oldStr = isFirstRender ? newStr : String(shownYear);
    if (!isFirstRender && oldStr === newStr) return; // same year — leave as-is
    shownYear = newYear;
    rollDigits(yearWatermarkEl, newStr, oldStr);
  }

  // ---- single source of truth: a plain slide index, never inferred from
  // scroll geometry ----
  // Every bug chased this session traced back to the same root cause:
  // trying to answer "what card are we on" by measuring the DOM (an
  // IntersectionObserver ratio, a live getBoundingClientRect() check)
  // WHILE the page is actively scrolling. At real scroll speed that's
  // measuring a blur — there's no meaningfully correct answer to "what's
  // 50% visible right now" mid-motion, so every geometry-based attempt
  // was at best a plausible guess a fast enough scroll could outrun or a
  // stale IntersectionObserver batch could contradict.
  //
  // currentIdx is instead changed ONLY at discrete, already-settled
  // moments: a debounced scroll that has genuinely stopped (scheduleSnap
  // below), a year-rail/button click, or the dedicated endscreen
  // transition. Nothing ever reads it back from scroll position — it IS
  // the position, and the counter/active-card/roadblock all read the
  // exact same variable, so they cannot structurally disagree.
  let currentIdx = 0;
  let activeSection = null;

  function deactivateCurrent() {
    if (!activeSection) return;
    activeSection.classList.remove("active");
    // Text drifts up and fades out rather than just vanishing — cleared
    // after the transition finishes so the card is back to its plain "not
    // yet active" resting state (below, invisible) in case it becomes
    // active again later (e.g. scrolling back).
    const outgoing = activeSection;
    outgoing.classList.add("leaving");
    setTimeout(() => outgoing.classList.remove("leaving"), 650);
    activeSection = null;
  }

  // The one function allowed to change the DISCRETE, safety-critical
  // state: currentIdx itself, the outro's deliberate reveal, and the
  // roadblock's arrival stamp. Called only from the settled moments
  // described above — never from a raw scroll/wheel event, and never by
  // measuring the DOM to decide WHICH index to apply (callers already
  // know the index; this just records it).
  //
  // Deliberately does NOT touch the counter, year rail, watermark, or
  // .active/.leaving — all of that is a display concern, not a safety
  // one: it should always match whatever's actually on screen, which
  // means it belongs with the continuous live tracker below, not gated
  // behind a settle. Bundling display into this function originally was
  // an over-broad fix — "the counter shouldn't need visual" was really
  // about the ROADBLOCK's decision-making needing to be reliable, not
  // about the on-screen number being allowed to lag behind the art.
  function applyState(idx) {
    const target = snapTargets[idx];
    if (!target) return;
    currentIdx = idx;
  }

  // ---- continuous display tracking (cosmetic only) ----
  // Which card's fixed art/text layer is showing, the counter, the year
  // rail, and the watermark — all tracked LIVE as you scroll, same as the
  // site always did. Deliberately separate from applyState/currentIdx:
  // nothing safety-critical (the roadblock, the outro's reveal) reads any
  // of this, so it doesn't matter that it's a continuous, best-effort
  // geometry check that could in principle be a frame stale during a fast
  // scroll — the worst case is a cosmetic flicker in a number, not a
  // skippable roadblock, which is what made the discrete rewrite worth
  // doing in the first place.
  // ---- cached geometry: measured ONCE, refreshed only on resize ----
  // This is the actual fix for card-to-card scrolling not feeling smooth.
  // updateDisplay used to call querySelectorAll(".event") and then
  // getBoundingClientRect() on all 131 of them on EVERY 'scroll' event.
  // getBoundingClientRect() forces a synchronous style+layout flush, and
  // the progress bar's own scroll listener writes progressBar.style.width
  // right afterward -- so every scroll tick was a read/write/read/write
  // layout thrash over 131 full-viewport sections. That cost lands
  // precisely during the smooth snap animation (native smooth scrolling
  // fires 'scroll' every frame), which is why the transition specifically
  // was the thing that stuttered.
  //
  // Every .event is a plain normal-flow block whose geometry only changes
  // on resize, so its position in DOCUMENT space can be measured once and
  // reused. Live scroll position is then just window.scrollY -- a number
  // that's free to read. 131 layout flushes per frame becomes zero.
  const heroEl = document.getElementById("hero");
  const eventEls = [...document.querySelectorAll(".event")];
  let heroGeom = { top: 0, height: 0 };
  let eventGeom = []; // { top, height } in document coords, index-aligned to eventEls
  function measureGeometry() {
    const sy = window.scrollY;
    const hr = heroEl.getBoundingClientRect();
    heroGeom = { top: hr.top + sy, height: hr.height };
    eventGeom = eventEls.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + sy, height: r.height };
    });
  }
  measureGeometry();
  // Images finishing their fade-in don't change .event box heights (the
  // art is position:fixed), but web fonts landing can reflow the hero, so
  // re-measure once everything has settled.
  window.addEventListener("load", measureGeometry);

  // Ratio of a cached box that's currently on screen -- pure arithmetic,
  // no DOM access at all.
  function geomRatio(g, sy, vh) {
    if (g.height <= 0) return 0;
    const top = g.top - sy;
    const visible = Math.min(top + g.height, vh) - Math.max(top, 0);
    return Math.max(0, visible) / g.height;
  }

  // The cards are sequential and roughly viewport-tall, so the winner is
  // always within a card or two of wherever the viewport's midpoint falls.
  // Binary-search to that neighbourhood and compare a handful of
  // candidates instead of scanning all 131 -- same "highest raw ratio, no
  // minimum threshold" rule as before (see the comment below for why
  // there's deliberately no floor), just without the linear sweep.
  function findWinner(sy, vh) {
    let winner = heroEl;
    let winnerRatio = geomRatio(heroGeom, sy, vh);
    if (!eventGeom.length) return winner;
    const probe = sy + vh / 2;
    let lo = 0;
    let hi = eventGeom.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (eventGeom[mid].top + eventGeom[mid].height <= probe) lo = mid + 1;
      else hi = mid;
    }
    for (let i = Math.max(0, lo - 2); i <= Math.min(eventGeom.length - 1, lo + 2); i++) {
      const r = geomRatio(eventGeom[i], sy, vh);
      if (r > winnerRatio) {
        winnerRatio = r;
        winner = eventEls[i];
      }
    }
    return winner;
  }

  function updateDisplay() {
    // Frozen for as long as the outro is showing: it isn't a
    // scroll-geometry destination at all (see snapTargets below), so this
    // function has no way to represent it -- without this check, any
    // stray 'scroll' event while the outro is up (e.g. a resize re-anchor)
    // would recompute from Kaltsit/Lemuen's real geometry and silently
    // stomp the counter/active-card back over the endscreen that's
    // actually on screen. revealEnding/exitEnding own the display state
    // for this pair explicitly instead.
    //
    // Deliberately NOT also frozen on endscreenLocked anymore. An earlier
    // version froze on it too, reasoning it needed to protect the swipe's
    // own class bookkeeping on lastEventEl -- but that froze real
    // scrolling's own visual feedback for the whole swipe duration too
    // (confirmed live: wheeling backward off Kaltsit right as a swipe was
    // in flight left the art/progress-bar visibly stuck, then jumping,
    // for the lock's duration). The outroEl.revealed check above already
    // covers the whole wipe's duration on its own (lastEventEl itself
    // never moves or changes geometry now -- see revealEnding/exitEnding
    // -- it's the outro panel's own clip-path that does the covering), so
    // no separate lock-based freeze is needed here at all.
    if (outroEl.classList.contains("revealed")) return;

    // Always shows WHICHEVER section is most visible right now, however
    // small that might be — never requires a minimum (e.g. >50%) before
    // showing anything. A fixed threshold sounds reasonable but has a real
    // failure mode: during a genuinely fast continuous scroll, a single
    // 'scroll' sample can land at a moment where NO section has crossed
    // 50% at all (each sample can jump past several cards at once), so
    // nothing would ever qualify — a real black screen for the whole fast
    // stretch, not just a momentary flicker, only correcting once the
    // scroll finally slows down enough for something to cross the old
    // threshold. Comparing raw ratios and always picking the highest,
    // with no floor, guarantees something reasonable is always shown.
    // #outro no longer participates here at all -- it's a permanent fixed
    // overlay, shown/hidden only by revealEnding/exitEnding directly, so
    // it can never "win" a visibility comparison it isn't part of.
    const winner = findWinner(window.scrollY, window.innerHeight);

    if (winner === heroEl) {
      if (activeSection) deactivateCurrent();
      yearWatermarkEl.classList.add("hidden");
      Object.values(yearButtons).forEach((btn) => btn.classList.remove("active"));
      counterEl.innerHTML = countHtml(0);
      syncVideoSlotVisibility();
      return;
    }

    if (winner !== activeSection) {
      deactivateCurrent();
      winner.classList.remove("leaving");
      winner.classList.add("active");
      activeSection = winner;
      syncVideoSlotVisibility();
    }
    const i = Number(winner.dataset.index);
    const year = Number(winner.dataset.year);
    counterEl.innerHTML = countHtml(i + 1);
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
    renderYearWatermark(year);
    yearWatermarkEl.classList.remove("hidden");
  }
  // No 'scroll' listener of its own anymore -- updateDisplay is driven by
  // the single coalesced pump below.

  // ---- scroll range ----
  // doc.scrollHeight is itself a layout-forcing read, so it's cached the
  // same way the card geometry above is: it only changes when the
  // document does, not on every tick. (The progress bar used to be sized
  // from this; it now follows the reel instead -- see renderReel.)
  let maxScroll = 0;
  function measureScrollRange() {
    const doc = document.documentElement;
    maxScroll = doc.scrollHeight - doc.clientHeight;
  }
  measureScrollRange();
  window.addEventListener("load", measureScrollRange);

  // Every scroll this file makes goes through here, so the pump below can
  // tell its own movement apart from movement it didn't make.
  let selfScrollY = window.scrollY;
  function scrollPageTo(y) {
    selfScrollY = Math.max(0, Math.min(maxScroll, y));
    window.scrollTo(0, selfScrollY);
    // The pump measures the next frame's movement from here, so scroll
    // passing through from a video in that same frame isn't read as
    // including this jump.
    lastPumpY = selfScrollY;
  }

  // ---- one coalesced scroll pump ----
  // Two separate 'scroll' listeners used to run per tick: one that READ
  // layout (updateDisplay) and one that WROTE style (the old scroll-sized
  // progress bar). Browsers fire scroll events faster than they paint, so
  // that was several full read/write cycles per frame, each one
  // invalidating the layout the next one had to re-resolve. One
  // rAF-coalesced callback now runs AT MOST once per frame, so the work is
  // capped at the refresh rate.
  let scrollPumpQueued = false;
  let lastPumpY = window.scrollY;
  function onScrollFrame() {
    scrollPumpQueued = false;
    const y = window.scrollY;
    const prevY = lastPumpY;
    lastPumpY = y;
    // Movement this file didn't make. Our own wheel/touch handlers prevent
    // the page's native scroll and drive the reel instead, so this is
    // mostly a wheel over a YouTube iframe: its wheel events never reach
    // this page, but the browser still passes the scroll through (confirmed
    // live: 3 ticks over a live iframe moved the page 300px, 0 wheel events
    // seen). Fed to the reel like any other input -- see onForeignScroll.
    if (y !== prevY && Math.abs(y - selfScrollY) > 2) {
      onForeignScroll(y - prevY);
    }
    updateDisplay(); // reads (cached geometry + scrollY)
  }
  window.addEventListener(
    "scroll",
    () => {
      if (scrollPumpQueued) return;
      scrollPumpQueued = true;
      requestAnimationFrame(onScrollFrame);
    },
    { passive: true }
  );

  // ---- buttons ----
  document.getElementById("begin-btn").addEventListener("click", () => {
    reelJumpTo(1); // snapTargets[0] is hero, [1] is the first event
  });
  document.getElementById("top-btn").addEventListener("click", () => {
    // Lives inside #outro, so clicking it needs to actually dismiss the
    // overlay too, not just scroll the (currently hidden-behind-it) page.
    // No swipe animation for this one -- jumping all the way back to the
    // hero is a bigger move than the one-card reverse swipe is built for,
    // so it just drops straight out.
    outroEl.classList.remove("revealed");
    lastEventEl.classList.remove("active", "leaving");
    if (activeSection === lastEventEl) activeSection = null;
    syncVideoSlotVisibility();
    reelJumpTo(0);
  });

  // ---- snap targets ----
  // Every position the page can rest on. The reel (below) decides which
  // one; the page only ever scrolls straight to one of these.
  const outroEl = document.getElementById("outro");
  // #outro deliberately excluded: it's a permanent fixed overlay now (see
  // style.css), not a document-flow section you scroll into, so it has no
  // place in a scroll-position-based target list at all.
  const snapTargets = [document.getElementById("hero"), ...document.querySelectorAll(".event")].filter(Boolean);
  const lastEventEl = [...document.querySelectorAll(".event")].pop();
  const kaltsitIdx = snapTargets.indexOf(lastEventEl);

  // snapTargets is [hero, ...events], so it lines up with the cached
  // geometry above: index 0 is heroGeom, index i is eventGeom[i - 1].
  function snapTargetTop(idx) {
    const g = idx === 0 ? heroGeom : eventGeom[idx - 1];
    return g ? g.top : 0;
  }
  // Reads the cache rather than calling getBoundingClientRect() on all
  // 132 targets. This ran on every gesture start AND every settle, both
  // of which happen while the page is moving -- same forced-layout cost
  // as updateDisplay's old sweep, landing at exactly the wrong moments.
  function nearestSnapIdx(sy = window.scrollY) {
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < snapTargets.length; i++) {
      const dist = Math.abs(snapTargetTop(i) - sy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    return nearest;
  }

  // ---- the reel: every card change goes through a zoom-out roulette ----
  // Input (wheel, touch, keys, and scroll passed through from a YouTube
  // iframe) moves a continuous reel position rather than the page. While it
  // moves, a fixed overlay zooms out into a vertical drum of cards and
  // rolls; once input stops it settles on a whole card, and only zooms back
  // in once that card's real art has loaded and decoded, so the page it
  // hands back to is never still dark. The page itself follows one card at
  // a time, and only while the overlay fully covers it -- video mounting,
  // the ending swipe, the counter and the year rail all keep running off
  // real scroll position exactly as before.
  // The card change is a slide: the reel's card-to-card roll, caption banner
  // and dimming, on a flat strip of full-size cards with no gap and no
  // zoom-out, so a change reads as one full-screen slide. The card fills the
  // screen, so the dimming's center window does too, and everything shows at
  // the center's brightness. Covering is quick, since there's no zoom to wait
  // on; landing waits for the card's video to be playing (landingVideoReady),
  // then crossfades slowly and gently straight onto it (see renderReel).
  // ?roulette in the URL brings back the zoomed-out drum it replaced.
  const SLIDE_MODE = !new URLSearchParams(location.search).has("roulette");
  if (SLIDE_MODE) document.body.classList.add("slide-mode");
  const REEL = SLIDE_MODE
    ? { curve: 0, cardSize: 1, gap: 0, zoomOutMs: 120, zoomInMs: 500, roll: 9, holdSpeed: 4, dim: 0.55, centerDim: 0.15 }
    : { curve: 16, cardSize: 1, gap: 110, zoomOutMs: 380, zoomInMs: 650, roll: 9, holdSpeed: 4, dim: 0.55, centerDim: 0.15 }; // cards off-center at 45% brightness, the center one at 85%
  const REEL_IDLE_MS = 170;             // no input for this long = the gesture is over
  const REEL_OUT_DWELL_MS = 120;        // minimum time fully zoomed out, so one tick doesn't read as a flicker
  const REEL_HANDOFF_TIMEOUT_MS = 1500; // zoom back in anyway if a card's art never finishes loading
  const REEL_PRELOAD_RADIUS = 20;
  const REEL_H = 1080;
  const WHEEL_STEP_PX = 100;            // one wheel notch's worth of scroll, until a real notch says otherwise (see wheelSteps)
  const WHEEL_BURST_GAP_MS = 200;       // a wheel resting this long starts a fresh scroll, whose first notch moves at once
  const FOREIGN_SETTLE_MS = 150;        // the page holds still until scroll passing through from a video has stopped this long
  const TOUCH_PX_PER_CARD = 420;
  // The roulette plays on every card change, even on a device that asks for
  // reduced motion -- by request; it used to skip the overlay there.

  const reelStage = document.getElementById("reel-stage");
  const reelWorld = document.getElementById("reel-world");
  const reelSpot = document.getElementById("reel-spot");
  const reelHud = document.getElementById("reel-hud");
  const reelLast = snapTargets.length - 1;
  const rClamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rEaseOut = (t) => 1 - Math.pow(1 - t, 3);
  const rEaseInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let reelPos = 0, reelTarget = 0, reelGestureStart = null, reelHeldDir = 0;
  let reelLastInput = -1e9;
  let reelZoomT = 0, reelZoomFrom = 0, reelZoomTo = 0, reelZoomStart = 0, reelZoomDur = 1, reelOutReadyAt = 0;
  let reelRunning = false, reelLastFrame = 0, reelSyncedIdx = -1, reelHudFor = -1, reelHudYear = "";
  // 16:9 cards, the same shape as the mockup. Zoomed all the way in, a card
  // covers the viewport the way the real art layer's object-fit:cover does:
  // scaled until it covers, centered.
  const reelW = 1920;
  const reelPitch = () => REEL_H + REEL.gap;
  const reelZoomIn = () => Math.max(innerWidth / reelW, innerHeight / REEL_H);
  const reelZoomOut = () => (SLIDE_MODE ? reelZoomIn() : Math.min((REEL.cardSize * innerHeight) / REEL_H, (0.9 * innerWidth) / reelW));

  const reelPreloaded = new Map();
  function reelPreloadAround(c) {
    // Lets go of pictures that are no longer near. Nothing used to leave
    // this map, so a long scroll kept a reference to every card's full-size
    // picture, and with it the browser's decoded copy.
    for (const i of reelPreloaded.keys()) {
      if (Math.abs(i - c) > REEL_PRELOAD_RADIUS) reelPreloaded.delete(i);
    }
    for (let i = c - REEL_PRELOAD_RADIUS; i <= c + REEL_PRELOAD_RADIUS; i++) {
      if (i < 1 || i > reelLast || reelPreloaded.has(i)) continue;
      const im = new Image();
      im.decoding = "async";
      im.src = MEMENTOS[i - 1].image;
      reelPreloaded.set(i, im);
    }
  }

  const reelCells = new Map();
  let reelRadius = 5, reelCenter = null;
  function makeReelCell(i) {
    const el = document.createElement("div");
    el.className = "reel-card";
    if (i === 0) {
      el.classList.add("reel-hero");
      el.innerHTML = "<span>M FOR<br>MEMENTOS</span>";
    } else {
      const img = new Image();
      img.decoding = "async";
      img.alt = "";
      img.src = MEMENTOS[i - 1].image;
      el.appendChild(img);
    }
    reelWorld.appendChild(el);
    return { el, i };
  }
  function syncReelCells(force) {
    const c = Math.round(reelPos);
    if (!force && c === reelCenter) return;
    reelCenter = c;
    reelPreloadAround(c);
    const want = new Set();
    for (let i = c - reelRadius; i <= c + reelRadius; i++) {
      if (i < 0 || i > reelLast) continue;
      want.add(i);
      if (!reelCells.has(i)) reelCells.set(i, makeReelCell(i));
    }
    for (const [i, cell] of reelCells) if (!want.has(i)) { cell.el.remove(); reelCells.delete(i); }
  }
  function rebuildReel() {
    reelWorld.style.setProperty("--reel-w", reelW + "px");
    reelWorld.style.setProperty("--reel-h", REEL_H + "px");
    reelStage.style.perspective = Math.round(innerHeight * 1.6) + "px";
    reelSpot.style.boxShadow = `0 0 0 300vmax rgba(5,7,10,${REEL.dim})`;
    reelSpot.style.background = `rgba(5,7,10,${REEL.centerDim})`;
    const flat = Math.ceil((innerHeight * 1.2) / (reelPitch() * reelZoomOut()) / 2) + 3;
    reelRadius = REEL.curve > 0.5 ? Math.min(flat, Math.floor(85 / REEL.curve)) : flat;
    syncReelCells(true);
  }
  // Card d positions from the center, laid on a drum whose arc between cards
  // is one pitch: spacing reads like a flat strip at the middle while the
  // reel bends away top and bottom.
  function placeReelCard(cell, d, worldScale, persp) {
    const step = (REEL.curve * Math.PI) / 180;
    const theta = d * step;
    let y = d * reelPitch(), z = 0, ang = 0;
    if (step > 0.009) {
      const r = reelPitch() / step;
      y = r * Math.sin(theta);
      z = r * (Math.cos(theta) - 1);
      ang = (-theta * 180) / Math.PI;
    }
    // Cards further around the drum project clean off the screen, and a
    // hidden layer is one the browser never rasterizes. Every card kept
    // visible is a near-full-screen, steeply tilted layer: with all of them
    // live, the GPU process tripled whenever the roulette was up (1.07GB,
    // against 307MB on a landed card). The half-card margin keeps the next
    // ones in before they can be seen.
    const shrink = persp / Math.max(1, persp - z * worldScale); // perspective at this depth
    const fromMiddle = Math.abs(y * worldScale * shrink);
    const halfCard = (REEL_H / 2) * worldScale * shrink * Math.abs(Math.cos(theta));
    const margin = REEL_H * worldScale * 0.5;
    cell.el.style.visibility = fromMiddle - halfCard > innerHeight / 2 + margin ? "hidden" : "";
    cell.el.style.transform = `translate3d(${-reelW / 2}px, ${y - REEL_H / 2}px, ${z}px) rotateX(${ang}deg)`;
  }

  function renderReel() {
    const vw = innerWidth, vh = innerHeight;
    const zIn = reelZoomIn(), zOut = reelZoomOut();
    const z = Math.exp(Math.log(zIn) + (Math.log(zOut) - Math.log(zIn)) * reelZoomT);
    reelWorld.style.transform = `translate(${vw / 2}px, ${vh / 2}px) scale3d(${z}, ${z}, ${z})`;
    const persp = Math.round(vh * 1.6); // matches rebuildReel's perspective
    for (const cell of reelCells.values()) placeReelCard(cell, cell.i - reelPos, z, persp);
    const vis = reelZoomT > 0 ? "visible" : "hidden";
    reelStage.style.visibility = reelSpot.style.visibility = reelHud.style.visibility = vis;
    // Opaque from zoomT 0.2 on the way out: the point the page underneath may
    // change. For the slide, landing fades out over its whole length instead
    // of its last fifth -- a gentle crossfade into the card, which the page
    // has already switched to by then.
    const stageAlpha = SLIDE_MODE && reelZoomTo === 0 ? reelZoomT : reelZoomT * 5;
    reelStage.style.opacity = rClamp(stageAlpha, 0, 1).toFixed(3);
    reelSpot.style.width = reelW * z + "px";
    reelSpot.style.height = REEL_H * z + "px";
    reelSpot.style.transform = `translate(${vw / 2 - (reelW * z) / 2}px, ${vh / 2 - (REEL_H * z) / 2}px)`;
    // Fades with the stage itself. Fading out earlier left the still-opaque
    // reel card at full brightness for a moment just before landing --
    // brighter than both the reel's shade and the card landed on.
    reelSpot.style.opacity = reelStage.style.opacity;
    reelHud.style.opacity = rClamp((reelZoomT - 0.4) / 0.4, 0, 1).toFixed(3);
    // The progress bar lives on the caption's banner and follows the reel
    // itself, so it glides along with the cards as they roll.
    progressBar.style.width = (reelLast > 0 ? (reelPos / reelLast) * 100 : 0).toFixed(2) + "%";
    const cur = rClamp(Math.round(reelPos), 0, reelLast);
    if (cur !== reelHudFor) {
      reelHudFor = cur;
      const m = cur > 0 ? MEMENTOS[cur - 1] : null;
      const year = m ? String(m.year) : "";
      if (year !== reelHudYear) {
        const ry = reelHud.querySelector(".ry");
        // Rolls between two years, like the page's own year; to or from the
        // hero card (no year) it just appears or goes.
        if (year && reelHudYear) rollDigits(ry, year, reelHudYear);
        else ry.textContent = year;
        reelHudYear = year;
      }
      reelHud.querySelector(".rl").innerHTML = m ? countHtml(cur) : "";
      reelHud.querySelector(".rn").textContent = m ? m.name : "M FOR MEMENTOS";
    }
  }

  function setReelZoom(to, now) {
    if (to === reelZoomTo) return;
    reelZoomFrom = reelZoomT;
    reelZoomTo = to;
    reelZoomStart = now;
    const full = to === 1 ? REEL.zoomOutMs : REEL.zoomInMs;
    reelZoomDur = Math.max(1, full * Math.abs(to - reelZoomFrom));
    if (to === 1) reelOutReadyAt = now + reelZoomDur + REEL_OUT_DWELL_MS;
  }

  // The page jumps straight to the card the reel is heading for. `force`
  // realigns it even when it's already that card, after scroll passed
  // through from a video has moved the page underneath.
  function syncLivePage(idx, force) {
    if (!force && idx === reelSyncedIdx) return;
    reelSyncedIdx = idx;
    scrollPageTo(snapTargetTop(idx));
  }

  // A reload returns to the card you were on from this record rather than
  // the browser's scroll restoration: with that on, a scroll passed through
  // from a video right after a reload couldn't be told apart from the
  // restoration itself, and was swallowed as one (confirmed live).
  const CARD_KEY = "mfmCard";
  let rememberedIdx = -1;
  function rememberCard(idx) {
    if (idx === rememberedIdx) return;
    rememberedIdx = idx;
    try { sessionStorage.setItem(CARD_KEY, String(idx)); } catch (e) {}
  }
  function savedCard() {
    try {
      const v = parseInt(sessionStorage.getItem(CARD_KEY), 10);
      return Number.isInteger(v) && v >= 0 && v <= reelLast ? v : null;
    } catch (e) {
      return null;
    }
  }

  // ---- let go of far-away card pictures ----
  // Each card's picture is a full-size still that costs about 8MB once the
  // browser decodes it, and they used to pile up: every card visited kept
  // its own for the rest of the session (measured: 53 loaded after 40 card
  // changes, on the way past a gigabyte across the whole archive). Only the
  // cards around the one in view keep theirs now. The rest drop back to
  // their data-src and reload (from cache, normally) when approached again
  // -- prepareLiveArt below waits for that before the roulette hands over,
  // so a returning card still can't flash in half-drawn.
  const ART_KEEP_RADIUS = 4;
  function releaseDistantArt(idx) {
    eventEls.forEach((section, i) => {
      if (Math.abs(i + 1 - idx) <= ART_KEEP_RADIUS) return;
      const img = section.querySelector(".event-media img");
      if (!img || !img.getAttribute("src")) return;
      img.removeAttribute("src");
      img.classList.remove("loaded");
    });
  }

  // The zoom-in waits on this: the landing card's real <img> loaded, shown
  // without its own fade-in, and decoded.
  let artWaitIdx = -1, artReadyIdx = -1, artWaitSince = 0;
  function prepareLiveArt(idx) {
    if (artWaitIdx === idx) return;
    artWaitIdx = idx;
    artReadyIdx = -1;
    artWaitSince = performance.now();
    const img = idx > 0 ? eventEls[idx - 1].querySelector(".event-media img") : null;
    if (!img) { artReadyIdx = idx; return; }
    const finish = () => {
      img.style.transition = "none";
      img.classList.add("loaded");
      (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => {
        if (artWaitIdx === idx) artReadyIdx = idx;
      });
    };
    if (!img.getAttribute("src")) img.src = img.dataset.src;
    if (img.complete && img.naturalWidth) finish();
    else img.addEventListener("load", finish, { once: true });
    releaseDistantArt(idx);
  }
  const liveArtReady = (idx, now) => artReadyIdx === idx || now - artWaitSince > REEL_HANDOFF_TIMEOUT_MS;
  // The slide lifts its cover straight onto the playing video, with no stop
  // on the card's still in between: it holds until the landing card's
  // video is revealed -- at its first PLAYING, or by engagePlayer's fallback
  // timer if playback never starts -- or not at all for a card with no video.
  // SLIDE_VIDEO_WAIT_MS lifts it regardless, in case no player ever mounts.
  const SLIDE_VIDEO_WAIT_MS = 4500;
  function landingVideoReady(idx, now) {
    if (now - artWaitSince > SLIDE_VIDEO_WAIT_MS) return true;
    const holder = idx > 0 ? eventEls[idx - 1]._videoHolder : null;
    if (!holder) return true;
    const entry = entryByHolder.get(holder);
    return !!(entry && entry.revealed);
  }

  // Starts the landing card's video the moment the reel knows where it's
  // landing -- never for cards it only rolls past, so no YouTube frame gets
  // created mid-roll, and no fixed wait before the video starts loading.
  let videoActivatedIdx = -1;
  let videosToDrop = false; // a card change started; reelFrame drops them once the roulette covers the screen
  let lastForeignAt = -Infinity; // last scroll passed through from a video (see onForeignScroll)
  function activateVideoFor(idx) {
    if (idx === videoActivatedIdx) return;
    videoActivatedIdx = idx;
    const holder = idx > 0 ? eventEls[idx - 1]._videoHolder : null;
    if (!holder) return;
    // Landed straight back on a card whose video is still retiring (see
    // dropVideos): start it over with a fresh player.
    const stale = entryByHolder.get(holder);
    if (stale && stale.retired) unmountVideoPlayer(stale);
    if (holder.dataset.customMounted) {
      const e = entryByHolder.get(holder);
      if (e) requestActivate(e);
      else holder._wantsActivate = true; // still loading; mountCustomPlayer's onReady picks this up
    } else {
      mountCustomPlayer(holder, true);
    }
  }

  function kickReel() {
    if (reelRunning) return;
    reelRunning = true;
    reelLastFrame = performance.now();
    requestAnimationFrame(reelFrame);
  }

  function reelFrame(now) {
    const dt = Math.min(0.05, (now - reelLastFrame) / 1000);
    reelLastFrame = now;
    if (reelHeldDir) {
      reelTarget = rClamp(reelTarget + reelHeldDir * REEL.holdSpeed * dt, 0, reelLast);
      reelLastInput = now;
    }
    const idle = now - reelLastInput > REEL_IDLE_MS;
    if (idle && reelGestureStart !== null) {
      // A short gesture still commits exactly one card; a long one lands wherever it rolled to.
      const d = reelTarget - reelGestureStart;
      reelTarget = rClamp(Math.abs(d) < 1 && Math.abs(d) > 0.02 ? reelGestureStart + Math.sign(d) : Math.round(reelTarget), 0, reelLast);
      reelGestureStart = null;
    }
    reelPos += (reelTarget - reelPos) * (1 - Math.exp(-dt * REEL.roll));
    const settled = idle && reelGestureStart === null && Math.abs(reelTarget - reelPos) < 0.002;
    if (settled) reelPos = reelTarget;
    const landing = rClamp(Math.round(reelTarget), 0, reelLast);
    // Moving the page while the browser is still smooth-scrolling a tick that
    // passed through from a video risks the two fighting over it.
    const pageCanMove = now - lastForeignAt > FOREIGN_SETTLE_MS;

    // The roulette is opaque from 0.2 -- the same point the page underneath may change.
    if (videosToDrop && (reelZoomT >= 0.2 || idle)) { videosToDrop = false; dropVideos(); }
    if ((reelZoomT >= 0.2 || settled) && pageCanMove) syncLivePage(landing, settled && Math.abs(scrollY - selfScrollY) > 1);
    if (idle && reelGestureStart === null && reelSyncedIdx === landing) activateVideoFor(landing);
    if (settled) { applyState(landing); rememberCard(landing); prepareLiveArt(landing); }

    if (!settled) setReelZoom(1, now);
    else if (now >= reelOutReadyAt && liveArtReady(landing, now) && (!SLIDE_MODE || landingVideoReady(landing, now))) setReelZoom(0, now);

    const p = rClamp((now - reelZoomStart) / reelZoomDur, 0, 1);
    reelZoomT = reelZoomFrom + (reelZoomTo - reelZoomFrom) * (reelZoomTo === 1 ? rEaseOut(p) : rEaseInOut(p));

    syncReelCells(false);
    renderReel();

    if (settled && reelZoomTo === 0 && p >= 1) reelRunning = false;
    else requestAnimationFrame(reelFrame);
  }

  function reelNudge(delta) {
    if (reelGestureStart === null) {
      reelGestureStart = Math.round(reelTarget);
      videoActivatedIdx = -1; // landing back on the same card has to be able to start its video again
      videosToDrop = true;
    }
    reelTarget = rClamp(reelTarget + delta, 0, reelLast);
    reelLastInput = performance.now();
    kickReel();
  }
  function reelJumpTo(idx) {
    idx = rClamp(idx, 0, reelLast);
    // Far jumps start rolling a few cards out instead of spinning past every card in between.
    if (Math.abs(idx - reelPos) > 3) reelPos = idx - Math.sign(idx - reelPos) * 3;
    reelTarget = idx;
    reelGestureStart = null;
    videoActivatedIdx = -1;
    videosToDrop = true;
    reelLastInput = performance.now();
    kickReel();
  }

  // ---- the ending: a forced swipe, both ways, not a scroll destination ----
  // #outro is a permanent fixed full-screen panel (style.css), like
  // Kaltsit's own art/text layers — contributing nothing to document
  // scrollHeight, so ordinary scrolling can never reach it at all. Kaltsit
  // itself is reached through the ordinary scheduleSnap debounce, same as
  // every other card -- this boundary is scoped ONLY to the swipe between
  // Kaltsit and the outro, once you're already settled on Kaltsit: the
  // very next forward wheel tick swipes straight into the ending
  // immediately, no wait, mirroring exitEnding's already-immediate
  // backward tick below.
  //
  // 2700ms (900ms x3, itself 3x Hypergryph's own measured 300ms Swiper
  // speed, both by explicit request -- their snappy pace didn't feel
  // right for this one-time finale beat). Must stay in sync with
  // style.css's own .sliding-out/.sliding-in/#outro transition durations
  // -- those two were found out of sync once already tonight, so double
  // check both sides after touching either.
  //
  // The lock (endscreenLocked) is purely duration-gated: armed once when
  // a swipe commits, released exactly SWIPE_MS later, ready immediately
  // for the very next tick -- NOT extended by further input during that
  // window. An earlier version made it settle-gated (re-arming on every
  // tick, only releasing once the wheel went fully idle), based on
  // stress-testing Hypergryph's real site with synthetic
  // dispatchEvent(WheelEvent) bursts, which looked locked for far longer
  // than one transition's duration. Reverted per direct observation of
  // the real site under actual use: it does NOT stay locked past the
  // transition itself. The likely explanation for the mismatch: a real
  // trackpad gesture fires a continuous, decaying stream of wheel events,
  // and their code may be waiting for that momentum to taper off, not
  // just for input to stop arriving -- a synthetic burst of fixed-size
  // ticks never decays, so it never looked "finished" to that logic,
  // producing a lock that isn't really there for genuine input.
  const SWIPE_MS = 2700;
  let endscreenLocked = false;
  let unlockTimer = null;

  // Arms the one-shot countdown that releases endscreenLocked, SWIPE_MS
  // after a swipe commits -- also guarantees the wipe's own CSS
  // transition has had time to finish before anything else touches
  // lastEventEl's classes again, which is why that cleanup lives here
  // instead of a separate timer.
  function scheduleUnlock() {
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      // The wipe is done and #outro now fully covers the screen either
      // way (forward: fully revealed; backward: fully hidden again) --
      // safe to settle Kaltsit's own active bookkeeping now regardless of
      // direction, matching whatever's actually true at this point. Uses
      // deactivateCurrent() rather than manually stripping the class so
      // activeSection itself gets nulled too, not just the CSS -- leaving
      // it stale here (still pointing at lastEventEl after its .active
      // was removed) is exactly the kind of mismatch revealEnding's own
      // cleanup above exists to guard against.
      if (outroEl.classList.contains("revealed") && activeSection === lastEventEl) {
        deactivateCurrent();
      }
      endscreenLocked = false;
    }, SWIPE_MS);
  }

  // Forward: a wipe, not a slide -- neither panel actually moves. Kaltsit
  // stays exactly where it is, fully visible, for the whole transition;
  // #outro (already sitting at its normal resting position, opaque,
  // above Kaltsit in z-index) has its own clip-path animated open by the
  // .revealed class in style.css, so a hard vertical edge sweeps across
  // the screen uncovering the outro from the right while Kaltsit stays
  // static underneath, only actually covered once the edge reaches it.
  // Replaced an earlier translateX-based slide per explicit request --
  // Hypergryph's real reference turned out to use a slide too (verified
  // via devtools), but a wipe is what was actually wanted here regardless
  // of that fidelity.
  function revealEnding() {
    endscreenLocked = true;
    applyState(kaltsitIdx);
    // Deactivate whatever ELSE might still be active first. The input that
    // triggers this can arrive a frame before updateDisplay's
    // own bookkeeping has caught up, so activeSection can still be some
    // earlier card (e.g. Lemuen) the instant this fires -- confirmed
    // live: 130/131's text visibly interleaved with 131/131's during the
    // wipe in, since text has no opaque background to hide one behind
    // the other. Kaltsit itself must stay ACTIVE (fully opaque) for the
    // whole wipe -- it's #outro's own expanding clip-path that
    // progressively covers it, not Kaltsit's own opacity -- so this only
    // clears activeSection when it's genuinely something OTHER than
    // lastEventEl, never lastEventEl itself.
    if (activeSection && activeSection !== lastEventEl) deactivateCurrent();
    lastEventEl.classList.remove("leaving");
    lastEventEl.classList.add("active");
    activeSection = lastEventEl;
    syncVideoSlotVisibility();
    outroEl.classList.add("revealed");
    // updateDisplay() never runs while the outro is revealed (see its own
    // guard above), and no real scrolling happens for this swipe either
    // (the input handlers prevent it) -- so nothing else will ever set the counter
    // to reflect the ending. Owning it explicitly here is what fixed a
    // real "counter still reads 127/131 while the endscreen is on screen"
    // bug: it was relying on a 'scroll' event that this transition never
    // fires to begin with.
    counterEl.innerHTML = countHtml(total + 1);
    // Same "nothing else will ever fix this" reasoning as the counter
    // line above applies to the year rail/watermark too -- updateDisplay
    // owns both normally, but it's frozen for as long as the outro is
    // revealed, so whatever year was highlighted right before this fired
    // would otherwise just sit there, stale, for the whole time the
    // ending is on screen. The ending stays within Kaltsit's own year the
    // whole time it's on screen, same value exitEnding restores on the
    // way back out, so nothing ever goes blank or unexplained.
    const kaltsitYear = Number(lastEventEl.dataset.year);
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === kaltsitYear));
    renderYearWatermark(kaltsitYear);
    yearWatermarkEl.classList.remove("hidden");
    scheduleUnlock();
  }

  // Reverse: #outro's clip-path animates back closed (see .revealed
  // removal in style.css), the covering edge sweeping back the other way
  // and shrinking the visible outro region from the left -- revealing
  // Kaltsit, which (same as the forward direction) never itself moves,
  // just needs to already be active/opaque underneath so there's
  // something correct to reveal as the edge passes over it.
  function exitEnding() {
    endscreenLocked = true;
    outroEl.classList.remove("revealed");
    lastEventEl.classList.remove("leaving");
    lastEventEl.classList.add("active");
    activeSection = lastEventEl;
    syncVideoSlotVisibility();
    // Same reasoning as revealEnding's counter line: own it explicitly
    // rather than hoping a 'scroll' event will come along and fix it.
    const i = Number(lastEventEl.dataset.index);
    counterEl.innerHTML = countHtml(i + 1);
    const year = Number(lastEventEl.dataset.year);
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
    renderYearWatermark(year);
    yearWatermarkEl.classList.remove("hidden");
    scheduleUnlock();
  }

  // Every input source goes through here, so the ending's boundary rules are
  // identical whether a card change came from the wheel, touch, a key, or a
  // scroll passed through from a video: a swipe in flight swallows input,
  // the outro only answers a backward move, and a forward move while
  // resting on the last card swipes into the ending instead of rolling.
  function reelInput(delta) {
    if (endscreenLocked) return false;
    if (outroEl.classList.contains("revealed")) {
      if (delta < 0) exitEnding();
      return false;
    }
    if (delta > 0 && !reelRunning && Math.round(reelTarget) === kaltsitIdx) {
      revealEnding();
      return false;
    }
    reelNudge(delta);
    return true;
  }

  // A scroll that reached the page without passing through the handlers
  // below (see onScrollFrame) -- almost always a wheel over a YouTube iframe,
  // which the browser passes through to the page. It steps the reel by the
  // same rule as the wheel itself (see wheelSteps). The page is left alone
  // until that scroll has finished (see pageCanMove in reelFrame) rather than
  // moved mid-motion, which fights the browser's own smooth scrolling of the
  // tick.
  function onForeignScroll(deltaPx) {
    lastForeignAt = performance.now();
    if (!wheelSteps(deltaPx)) {
      // Refused (the ending owns input right now), so no settle will come
      // along to realign the page.
      scrollPageTo(snapTargetTop(rClamp(reelSyncedIdx, 0, reelLast)));
    }
  }

  // The wheel moves like the arrow keys: a scroll's first notch steps a whole
  // card straight away, and each further notch's worth of scroll one more --
  // rather than rolling the reel a fraction of a card per notch and only
  // committing to a card once the wheel rests, which read as a sluggish
  // two-stage move next to a key press. The notch size comes from the real
  // wheel events seen here (WHEEL_STEP_PX until one arrives), so a mouse set
  // to scroll more lines per notch still moves one card per notch.
  let wheelNotchPx = WHEEL_STEP_PX, wheelAcc = 0, wheelDir = 0, wheelLastAt = -Infinity;
  function wheelSteps(px) {
    const dir = Math.sign(px);
    if (!dir) return true;
    const now = performance.now();
    // Every bit of wheel input keeps the reel from counting as idle, stepping
    // or not -- a player the scroll may still be passing through stays alive
    // for it (see dropVideos).
    reelLastInput = now;
    let accepted = true;
    if (now - wheelLastAt > WHEEL_BURST_GAP_MS || dir !== wheelDir) {
      wheelDir = dir;
      wheelAcc = Math.max(0, Math.abs(px) - wheelNotchPx);
      accepted = reelInput(dir);
    } else {
      wheelAcc += Math.abs(px);
    }
    wheelLastAt = now;
    while (accepted && wheelAcc >= wheelNotchPx) {
      wheelAcc -= wheelNotchPx;
      accepted = reelInput(dir);
    }
    return accepted;
  }

  window.addEventListener("wheel", (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1;
    const px = e.deltaY * unit;
    // A notch-sized event sets the step; a touchpad's stream of small ones doesn't.
    if (Math.abs(px) >= 40) wheelNotchPx = Math.abs(px);
    wheelSteps(px);
  }, { passive: false });

  let reelTouchY = null;
  window.addEventListener("touchstart", (e) => {
    const onInput = e.target.closest && e.target.closest("input");
    reelTouchY = e.touches.length === 1 && !onInput ? e.touches[0].clientY : null;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (reelTouchY === null || e.touches.length !== 1) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    reelInput((reelTouchY - y) / TOUCH_PX_PER_CARD);
    reelTouchY = y;
  }, { passive: false });
  window.addEventListener("touchend", () => { reelTouchY = null; }, { passive: true });

  // ---- keyboard ----
  // Keys are delivered by focus, not by where the mouse is, so they reach
  // this page even while the cursor sits over a YouTube iframe. A tap is
  // exactly one card; held down, the reel spins at its own pace (the OS's
  // key-repeat is ignored) until release.
  const navKey = (e) => e.code || e.key; // some input paths deliver only one of the two
  const keyDir = (k) => (k === "ArrowDown" || k === "PageDown" ? 1 : k === "ArrowUp" || k === "PageUp" ? -1 : 0);
  let reelHoldTimer = null;
  function stopHold() {
    clearTimeout(reelHoldTimer);
    if (!reelHeldDir) return;
    reelHeldDir = 0;
    reelLastInput = performance.now();
    kickReel();
  }
  window.addEventListener("keydown", (e) => {
    const dir = keyDir(navKey(e));
    if (!dir) return;
    // Don't steal a focused control's own key handling -- but a plain
    // BUTTON has none for the arrows (and #begin-btn/the tag chips keep
    // focus after a click). INPUT still bails: the volume slider uses them.
    const active = document.activeElement;
    const tag = active?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable) return;
    e.preventDefault();
    if (e.repeat) return;
    stopHold();
    if (!reelInput(dir)) return;
    reelHoldTimer = setTimeout(() => { reelHeldDir = dir; kickReel(); }, 300);
  });
  window.addEventListener("keyup", (e) => { if (keyDir(navKey(e))) stopHold(); });
  // Alt-tabbing mid-hold never delivers the keyup.
  window.addEventListener("blur", stopHold);

  // Clicking the player puts keyboard focus INSIDE the cross-origin iframe,
  // and keys delivered there never reach this page -- the one remaining way
  // the arrows could dead-end the way the wheel used to (the wheel itself is
  // handled: see onScrollFrame). YouTube's own keyboard handling is off
  // (disablekb:1 in playerVars), so it loses nothing by handing focus back.
  // Fullscreen is the exception -- there the player really is the thing
  // being used, and cards shouldn't be moving behind it.
  window.addEventListener("focusin", (e) => {
    if (document.fullscreenElement) return;
    const el = e.target;
    if (el.tagName !== "IFRAME" || !el.closest(".yt-frame")) return;
    // Next tick, so this never lands in the middle of the player's own
    // handling of the click that moved focus here.
    setTimeout(() => {
      if (!document.fullscreenElement && document.activeElement === el) el.blur();
    }, 0);
  });

  // ---- keep the current slide stable across viewport-height changes ----
  // Every card is sized with min-height:100vh. A viewport-height change —
  // entering/exiting fullscreen, the browser toolbar hiding, a window
  // resize — changes 100vh itself, resizing every card and reflowing the
  // document's total height, all without a single pixel of actual
  // scrolling (observed: toggling fullscreen alone used to jump the
  // displayed card from 122/131 to 104/131 purely from this). Since
  // currentIdx is real state now, not something read back from scroll
  // position, fixing this is just: re-scroll to wherever currentIdx's
  // target actually is post-resize. The index itself never needs to
  // change here at all.
  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      updateRailsLayout();
      // A resize is the one thing that genuinely invalidates the cached
      // geometry (every card is min-height:100vh, so a viewport-height
      // change resizes all 131 and moves every document offset). Both
      // caches are rebuilt here -- this is the ONLY place they're
      // rebuilt during normal use, which is the whole point: one
      // measurement pass on a rare event instead of 131 per scroll tick.
      measureGeometry();
      measureScrollRange();
      rebuildReel();
      reelSyncedIdx = -1;
      syncLivePage(rClamp(Math.round(reelTarget), 0, reelLast));
      renderReel();
    });
  });

  // Start on the card from before a reload (see rememberCard), otherwise
  // wherever the page happens to be.
  reelPos = reelTarget = savedCard() ?? nearestSnapIdx();
  applyState(reelTarget);
  syncLivePage(reelTarget, true);
  rememberCard(reelTarget);
  activateVideoFor(reelTarget);
  rebuildReel();
  renderReel();
  updateDisplay(); // no 'scroll' event fires on load if scrollY is unchanged
})();
