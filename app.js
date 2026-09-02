(function () {
  const eventsRoot = document.getElementById("events");
  const yearRail = document.getElementById("year-rail");
  const counterEl = document.getElementById("counter");
  const progressBar = document.getElementById("progress-bar");

  const total = MEMENTOS.length;
  const years = [...new Set(MEMENTOS.map((m) => m.year))];


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
        goTo(snapTargets.indexOf(target));
        target.scrollIntoView({ behavior: "smooth" });
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
      .map((t) =>
        t.url
          ? `<a class="tag-chip" href="${escapeAttr(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.label)}</a>`
          : `<span class="tag-chip">${escapeHtml(t.label)}</span>`
      )
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
        <p class="event-quote">${escapeHtml(m.favorText)}</p>
        <h2 class="event-name">${escapeHtml(m.name)}</h2>
        <div class="event-tags">${tagsHtml}</div>
      </div>
    `;
    frag.appendChild(section);
  });
  eventsRoot.appendChild(frag);

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(str) {
    return escapeHtml(str);
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
  const imgObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src && !img.src) {
            img.src = img.dataset.src;
            img.addEventListener("load", () => img.classList.add("loaded"));
          }
          obs.unobserve(img);
        }
      });
    },
    { rootMargin: "600px 0px" }
  );
  document.querySelectorAll(".event-media img").forEach((img) => imgObserver.observe(img));

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
  let currentlyPlaying = null; // { pause() } or null
  function pauseCurrentlyPlaying() {
    currentlyPlaying?.pause();
    currentlyPlaying = null;
  }
  function setCurrentlyPlaying(entry) {
    if (currentlyPlaying === entry) return;
    pauseCurrentlyPlaying();
    currentlyPlaying = entry;
  }
  // Watches the .event SECTION (normal document flow, real scroll-based
  // geometry) rather than any position:fixed video layer itself, same
  // reasoning as everywhere else in this file that a fixed element can't
  // be observed this way (it's always "in the viewport" regardless of
  // scroll). Pauses ONLY if this specific entry is still the one actually
  // playing when it drops below the 0.5 threshold -- a card that scrolled
  // away after something ELSE already took over playback shouldn't pause
  // that newer video by mistake.
  function observeVideoVisibility(section, entry) {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if ((!e.isIntersecting || e.intersectionRatio <= 0.5) && currentlyPlaying === entry) {
            pauseCurrentlyPlaying();
          }
        });
      },
      { threshold: 0.5 }
    );
    obs.observe(section);
    return obs;
  }

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
    customPlayers.forEach((player) => {
      if (on) player.unMute();
      else player.mute();
    });
  }
  soundToggleBtn.addEventListener("click", () => setSoundEnabled(!soundEnabled));

  // Pressing Space is the browser's native "scroll down ~one page"
  // shortcut -- with every card sized min-height:100vh, that lands
  // roughly on the next card, reading as "space jumps to the next event."
  // Reasonable default, but not while something's actually playing: in
  // that case Space pausing the video is the more useful, expected
  // behavior (matches YouTube's own site), so the native scroll is
  // suppressed specifically for that one case. Left alone (no
  // preventDefault) when a focused element would normally use Space
  // itself (a button's own activate-on-space).
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !currentlyPlaying) return;
    const active = document.activeElement;
    const tag = active?.tagName;
    if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) return;
    e.preventDefault();
    pauseCurrentlyPlaying();
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
      document.head.appendChild(script);
    });
    return ytApiPromise;
  }

  // Builds the play/pause button + draggable seek track, appended into
  // the .yt-frame holder above the player itself (z-index in style.css).
  // Returns element refs the caller wires up once the real player exists.
  // The click-catcher: a transparent layer covering the WHOLE frame,
  // sitting above the raw iframe but below the controls bar in stacking
  // order. Without it, only the bottom controls bar is ours -- the rest
  // of the frame is a direct, unobstructed click target on the actual
  // YouTube iframe underneath, and YouTube's player responds to a direct
  // click (even with playerVars.controls:0) with its own native
  // play/pause toggle AND the big center icon flash, plus other native
  // overlays (cards/annotations) that controls:0 doesn't suppress either.
  // This intercepts every click before it can ever reach the iframe, so
  // none of that native chrome ever has a chance to appear -- confirmed
  // live as the actual source of the center icon (see caller).
  function buildClickCatcher(holder) {
    const catcher = document.createElement("div");
    catcher.className = "yt-click-catcher";
    holder.appendChild(catcher);
    return catcher;
  }

  function buildCustomControls(holder) {
    const bar = document.createElement("div");
    bar.className = "yt-custom-controls";
    bar.innerHTML = `
      <button class="yt-playpause" type="button" aria-label="Play or pause">
        <svg class="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <svg class="icon-pause" viewBox="0 0 24 24" hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
      </button>
      <div class="yt-seek-track">
        <div class="yt-seek-fill"></div>
        <div class="yt-seek-handle"></div>
      </div>
    `;
    holder.appendChild(bar);
    return {
      bar,
      playPauseBtn: bar.querySelector(".yt-playpause"),
      iconPlay: bar.querySelector(".icon-play"),
      iconPause: bar.querySelector(".icon-pause"),
      track: bar.querySelector(".yt-seek-track"),
      fill: bar.querySelector(".yt-seek-fill"),
      handle: bar.querySelector(".yt-seek-handle"),
    };
  }

  // Wires the seek track to real pointer drag (mouse + touch, via pointer
  // events) rather than just click-to-seek, so scrubbing feels like a
  // real player. While dragging, the progress-poll loop below is told to
  // back off (via the returned isDragging() check) so it can't fight the
  // handle's position mid-drag.
  function wireSeekTrack(controls, player) {
    let dragging = false;
    function ratioFromEvent(e) {
      const rect = controls.track.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      return rect.width > 0 ? x / rect.width : 0;
    }
    function setVisual(ratio) {
      controls.fill.style.width = `${ratio * 100}%`;
      controls.handle.style.left = `${ratio * 100}%`;
    }
    controls.track.addEventListener("pointerdown", (e) => {
      dragging = true;
      controls.track.setPointerCapture(e.pointerId);
      setVisual(ratioFromEvent(e));
    });
    controls.track.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      setVisual(ratioFromEvent(e));
    });
    function commitSeek(e) {
      if (!dragging) return;
      dragging = false;
      const duration = player.getDuration();
      if (duration > 0) player.seekTo(ratioFromEvent(e) * duration, true);
    }
    controls.track.addEventListener("pointerup", commitSeek);
    controls.track.addEventListener("pointercancel", () => {
      dragging = false;
    });
    return { isDragging: () => dragging };
  }

  // Polls getCurrentTime()/getDuration() rather than relying on
  // onStateChange alone -- YouTube's player doesn't fire a continuous
  // "time update" event the way a native <video> does, so a short
  // interval is the standard way to keep a custom seek bar's fill
  // visually in sync with real playback.
  //
  // ONE shared interval for the whole page, not one per mounted player.
  // With every PV on the site now getting a custom player (100+
  // potential mounts over a long scroll), a per-player setInterval left
  // running forever after each mount would keep compounding for the rest
  // of the session. Only one video can ever be playing at a time anyway
  // (see currentlyPlaying above), so only one entry's UI ever needs
  // updating at once -- this just points at whichever that is.
  let activeProgressUI = null; // { controls, player, dragState } or null
  setInterval(() => {
    if (!activeProgressUI) return;
    const { controls, player, dragState } = activeProgressUI;
    if (dragState.isDragging()) return;
    const duration = player.getDuration();
    if (!duration) return;
    const ratio = player.getCurrentTime() / duration;
    controls.fill.style.width = `${ratio * 100}%`;
    controls.handle.style.left = `${ratio * 100}%`;
  }, 250);

  function updatePlayPauseIcon(controls, playerState) {
    const playing = playerState === 1; // YT.PlayerState.PLAYING
    controls.iconPlay.hidden = playing;
    controls.iconPause.hidden = !playing;
  }

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

  // ---- cap how many players stay mounted at once ----
  // Every mounted player is a real YouTube iframe -- a full embedded page,
  // not a cheap DOM node -- and nothing was ever destroying old ones as
  // the visitor scrolled past ("only one plays" only ever paused them).
  // Across 126 potential videos in one long scroll, that meant every
  // single one ever visited stayed alive in memory for the rest of the
  // session (confirmed live: the tab reached 2.8GB). This keeps only the
  // most recently mounted MAX_MOUNTED_VIDEOS around, destroying the
  // oldest beyond that the moment a new one mounts -- an evicted card
  // just reverts to its static image, and re-mounts normally (full
  // burn-reveal and all) if scrolled back to later, same as if it had
  // never been visited.
  const MAX_MOUNTED_VIDEOS = 3;
  const mountedQueue = []; // entries, oldest first

  function unmountVideoPlayer(entry) {
    const qIdx = mountedQueue.indexOf(entry);
    if (qIdx !== -1) mountedQueue.splice(qIdx, 1);
    if (currentlyPlaying === entry) currentlyPlaying = null;
    if (activeProgressUI && activeProgressUI.player === entry.player) activeProgressUI = null;
    const pIdx = customPlayers.indexOf(entry.player);
    if (pIdx !== -1) customPlayers.splice(pIdx, 1);
    entry.player.destroy(); // YT.Player's own teardown -- removes its iframe
    entry.holder.innerHTML = ""; // drop the custom controls too
    delete entry.holder.dataset.customMounted;
  }

  function enforceMountCap() {
    while (mountedQueue.length > MAX_MOUNTED_VIDEOS) {
      // Skip the currently-playing one even if it's the oldest in the
      // queue -- shouldn't normally happen (scrolling to a new card
      // pauses whatever was playing before it), but never yank the video
      // literally in front of the visitor out from under them.
      const target = mountedQueue.find((e) => e !== currentlyPlaying);
      if (!target) break;
      unmountVideoPlayer(target);
    }
  }

  async function mountCustomPlayer(holder) {
    if (holder.dataset.customMounted) return;
    holder.dataset.customMounted = "1";
    const { ytId, ytStart } = holder.dataset;
    const YT = await loadYoutubeApi();
    // A card can scroll out and get evicted while the API script itself
    // is still loading (real network time) -- if so, just bail rather
    // than mounting a player into a holder nobody's watching anymore.
    if (!holder.dataset.customMounted) return;

    const playerEl = document.createElement("div");
    holder.appendChild(playerEl);
    const clickCatcher = buildClickCatcher(holder);
    const controls = buildCustomControls(holder);
    function togglePlayPause() {
      const state = player.getPlayerState();
      if (state === 1) player.pauseVideo();
      else player.playVideo();
    }
    controls.playPauseBtn.addEventListener("click", togglePlayPause);
    clickCatcher.addEventListener("click", togglePlayPause);

    const player = new YT.Player(playerEl, {
      videoId: ytId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        mute: soundEnabled ? 0 : 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        start: ytStart ? Number(ytStart) : undefined,
      },
      events: {
        onReady: (e) => {
          holder.closest(".event-media")?.classList.add("video-ready");
          // Belt-and-suspenders: playerVars.mute already set the initial
          // state, but re-asserting here covers the case where
          // soundEnabled changed in the moment between construction and
          // ready (a click on the toggle right as this was loading).
          if (soundEnabled) e.target.unMute();
          else e.target.mute();
          e.target.playVideo();
        },
        onStateChange: (e) => {
          updatePlayPauseIcon(controls, e.data);
          if (e.data === 1) { // PLAYING
            setCurrentlyPlaying(entry);
            activeProgressUI = { controls, player, dragState };
          }
        },
      },
    });
    const entry = { holder, player, pause: () => player.pauseVideo() };
    customPlayers.push(player);
    const dragState = wireSeekTrack(controls, player);
    observeVideoVisibility(holder.closest(".event"), entry);
    mountedQueue.push(entry);
    enforceMountCap();
  }

  // Every video card (site-wide, not just one special-cased ID) gets the
  // same auto-mount-on-scroll-into-view treatment Concept Trailer III got
  // first. Watches the .event SECTION (normal document flow, real
  // scroll-based geometry) rather than the .yt-frame itself
  // (position:fixed, always "in the viewport" regardless of scroll -- see
  // the same reasoning elsewhere for why fixed layers can't be observed
  // this way). Same 0.5 visibility threshold the rest of the app uses to
  // mean "this is genuinely the thing on screen."
  //
  // Deliberately NOT one-shot anymore (an earlier version disconnected
  // after the first fire): now that mounted players can be evicted by
  // enforceMountCap, a card needs to be able to mount again later if
  // scrolled back to after being evicted, not just once ever. The
  // dataset.customMounted check keeps re-firing intersections from doing
  // anything while a card is already mounted.
  document.querySelectorAll(".yt-frame[data-yt-id]").forEach((holder) => {
    const section = holder.closest(".event");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5 && !holder.dataset.customMounted) {
            setTimeout(() => mountCustomPlayer(holder), 300);
          }
        });
      },
      { threshold: 0.5 }
    );
    observer.observe(section);
  });

  // ---- year watermark: slot-machine digit roll on actual year change ----
  const yearWatermarkEl = document.getElementById("year-watermark");
  let shownYear = null;
  function renderYearWatermark(newYear) {
    const newStr = String(newYear);
    const isFirstRender = shownYear === null;
    const oldStr = isFirstRender ? newStr : String(shownYear);
    if (!isFirstRender && oldStr === newStr) return; // same year — leave as-is
    shownYear = newYear;

    yearWatermarkEl.innerHTML = "";
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
      yearWatermarkEl.appendChild(slot);
    }
    requestAnimationFrame(() => {
      yearWatermarkEl.querySelectorAll(".digit-roll").forEach((r) => r.classList.add("rolling"));
    });
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
    const heroEl = document.getElementById("hero");
    let winner = heroEl;
    let winnerRatio = visibleRatio(heroEl.getBoundingClientRect());
    document.querySelectorAll(".event").forEach((el) => {
      const r = visibleRatio(el.getBoundingClientRect());
      if (r > winnerRatio) {
        winnerRatio = r;
        winner = el;
      }
    });

    if (winner === heroEl) {
      if (activeSection) deactivateCurrent();
      yearWatermarkEl.classList.add("hidden");
      Object.values(yearButtons).forEach((btn) => btn.classList.remove("active"));
      counterEl.textContent = `00 / ${total}`;
      return;
    }

    if (winner !== activeSection) {
      deactivateCurrent();
      winner.classList.remove("leaving");
      winner.classList.add("active");
      activeSection = winner;
    }
    const i = Number(winner.dataset.index);
    const year = Number(winner.dataset.year);
    counterEl.textContent = `${String(i + 1).padStart(2, "0")} / ${total}`;
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
    renderYearWatermark(year);
    yearWatermarkEl.classList.remove("hidden");
  }
  function visibleRatio(rect) {
    if (rect.height <= 0) return 0;
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    return visibleHeight / rect.height;
  }
  window.addEventListener("scroll", updateDisplay, { passive: true });

  // Explicit navigation entry point (year rail, begin/top buttons): jump
  // straight to a known index. Named separately from applyState even
  // though it's a thin wrapper, so call sites read as intent ("go to
  // this slide") rather than "apply this rendering."
  function goTo(idx) {
    applyState(idx);
  }

  // ---- scroll progress bar ----
  function updateProgress() {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const scrollHeight = doc.scrollHeight - doc.clientHeight;
    const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    progressBar.style.width = pct + "%";
  }
  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();

  // ---- buttons ----
  document.getElementById("begin-btn").addEventListener("click", () => {
    goTo(1); // snapTargets[0] is hero, [1] is the first event
    document.getElementById("events").scrollIntoView({ behavior: "smooth" });
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
    goTo(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- gentle snap-to-card once scrolling has actually settled ----
  // Deliberately not native CSS scroll-snap: that reacts on every scroll
  // tick, which is exactly what makes a fast scroll feel interrupted. This
  // only evaluates once real wheel/touch input has been idle for a beat —
  // so a fast wheel-spree never gets nudged mid-motion, only the resting
  // position gets aligned once you've actually stopped. That "actually
  // stopped" moment is also the only time currentIdx is allowed to change
  // from ordinary scrolling — see applyState's big comment above.
  const outroEl = document.getElementById("outro");
  // #outro deliberately excluded: it's a permanent fixed overlay now (see
  // style.css), not a document-flow section you scroll into, so it has no
  // place in a scroll-position-based target list at all.
  const snapTargets = [document.getElementById("hero"), ...document.querySelectorAll(".event")].filter(Boolean);
  const lastEventEl = [...document.querySelectorAll(".event")].pop();
  const kaltsitIdx = snapTargets.indexOf(lastEventEl);

  function nearestSnapTarget() {
    let nearest = null;
    let nearestDist = Infinity;
    snapTargets.forEach((el) => {
      const dist = Math.abs(el.getBoundingClientRect().top);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = el;
      }
    });
    return nearest;
  }

  // How far (px) you need to move from where THIS gesture started before
  // it commits to the next/previous card, instead of snapping back to the
  // one you started on. Deliberately not "whichever card is nearest by raw
  // distance" — that requires crossing the halfway point (~50% of a
  // viewport-tall card) before it flips, which felt like it took several
  // wheel ticks to turn a page. This is a flat, card-height-independent
  // threshold. Was 70 (roughly 2 wheel ticks on real hardware), halved to
  // roughly 1 tick by explicit request.
  const SNAP_COMMIT_PX = 35;

  let snapTimer = null;
  let gestureStartY = 0;
  let gestureStartIdx = 0;
  function scheduleSnap() {
    if (!snapTimer) {
      // Fresh gesture starting from an already-settled position — record
      // where it began so later we can measure net movement from HERE,
      // not just "whatever's closest right now."
      gestureStartY = window.scrollY;
      gestureStartIdx = snapTargets.indexOf(nearestSnapTarget());
    }
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const delta = window.scrollY - gestureStartY;
      // Small movement: snap back to wherever the gesture started (this is
      // the 2-tick "resist jitter" behavior). Large movement: land on
      // whichever card is ACTUALLY nearest right now, evaluated fresh at
      // fire-time — not capped at ±1 from the start index, which was the
      // "snaps 20 events back" bug: a long continuous scroll can land many
      // cards past where it started, and capping the landing to ±1 meant
      // jumping backward across everything already scrolled past.
      // No explicit clamp needed to keep this from landing past Kaltsit:
      // #outro isn't in snapTargets at all anymore (it's a permanent fixed
      // overlay, not a scroll destination), so nearestSnapTarget() can
      // never resolve to it in the first place.
      const targetIdx =
        Math.abs(delta) <= SNAP_COMMIT_PX ? gestureStartIdx : snapTargets.indexOf(nearestSnapTarget());
      const target = snapTargets[targetIdx];
      if (target && Math.abs(target.getBoundingClientRect().top) > 4) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      applyState(targetIdx);
      snapTimer = null;
      // 500ms, not 150ms: a slow, deliberate scroller naturally pauses
      // between individual wheel ticks (each notch), and a short debounce
      // treats that natural gap as "done scrolling," evaluating (and
      // resetting gestureStartY) before they've made enough ticks to
      // reach the commit threshold above. This needs to be patient enough
      // to span that inter-tick gap.
    }, 500);
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
    // Deactivate whatever ELSE might still be active first. The live
    // geometry trigger in onWheel can fire a frame before updateDisplay's
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
    outroEl.classList.add("revealed");
    // updateDisplay() never runs while the outro is revealed (see its own
    // guard above), and no real scrolling happens for this swipe either
    // (onWheel prevents it) -- so nothing else will ever set the counter
    // to reflect the ending. Owning it explicitly here is what fixed a
    // real "counter still reads 127/131 while the endscreen is on screen"
    // bug: it was relying on a 'scroll' event that this transition never
    // fires to begin with.
    counterEl.textContent = `${total + 1} / ${total}`;
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
    // Same reasoning as revealEnding's counter line: own it explicitly
    // rather than hoping a 'scroll' event will come along and fix it.
    const i = Number(lastEventEl.dataset.index);
    counterEl.textContent = `${String(i + 1).padStart(2, "0")} / ${total}`;
    const year = Number(lastEventEl.dataset.year);
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
    renderYearWatermark(year);
    yearWatermarkEl.classList.remove("hidden");
    scheduleUnlock();
  }

  function onWheel(e) {
    // Blocks ALL wheel input for as long as a swipe (either direction) is
    // actively mid-animation -- checked first, before anything else, so
    // it applies uniformly regardless of outroEl.revealed's own momentary
    // state (exitEnding flips that class the instant it starts, well
    // before the animation itself finishes). Restores the original "hard
    // stop, can't scroll past" intent for this one boundary specifically:
    // without this, continuous real scrolling right as you exit the
    // ending blows straight through Kaltsit mid-wipe instead of landing
    // on it first (confirmed live: exiting while still wheeling landed
    // on card 125, nowhere near Kaltsit, in one unbroken motion).
    //
    // This is deliberately NOT the same thing as the earlier "131 jump"
    // fix below, and doesn't undo it: endscreenLocked is only ever true
    // during an ACTIVE swipe -- it's already false the moment you're
    // genuinely resting on Kaltsit with no swipe in flight, so ordinary
    // backward scrolling away from an already-settled Kaltsit (reached
    // the normal way, via scheduleSnap) is completely unaffected by this
    // check and stays exactly as responsive as that fix made it.
    if (endscreenLocked) {
      e.preventDefault();
      return;
    }
    if (outroEl.classList.contains("revealed")) {
      // The outro is a fixed overlay sitting on top of Kaltsit's own
      // position -- without this, wheel input would scroll the page
      // underneath it while it's shown. Any backward input immediately
      // triggers the return swipe; forward input while already at the
      // end is simply absorbed. (endscreenLocked, checked above, already
      // covers "swipe in flight" -- by the time control reaches here,
      // it's always the settled, ready-for-input case.)
      e.preventDefault();
      if (e.deltaY < 0) exitEnding();
      return;
    }
    // Whenever Kaltsit is genuinely the thing on screen right now, the
    // very next forward tick swipes straight into the ending -- immediate,
    // no wait, mirroring exitEnding's backward tick above. Deliberately a
    // LIVE geometry check (same >0.5 threshold updateDisplay itself uses
    // to decide a winner), not currentIdx: currentIdx only updates once
    // scheduleSnap's 500ms debounce settles, which broke this two
    // different ways when tried -- (1) wheeling continuously with no
    // pause never let currentIdx catch up to kaltsitIdx at all, so the
    // ending could only ever be reached by stopping first, which read as
    // a wall; (2) after fast-scrolling AWAY from Kaltsit and back within
    // that 500ms window, currentIdx could still stale-read kaltsitIdx
    // while the real screen showed a totally different card (confirmed
    // live: card 116's own text/art rendered behind the endscreen, with
    // the year rail stuck on that card's year). A fresh
    // getBoundingClientRect() check has neither lag -- it reflects
    // exactly what's on screen at the instant of this wheel event, same
    // as updateDisplay's own winner-picking logic.
    //
    // Deliberately scoped to ONLY this one boundary: an earlier attempt
    // extended the immediate-tick pattern to the Lemuen<->Kaltsit boundary
    // too, which introduced the same class of corruption there -- reverted
    // in favor of leaving every other card-to-card transition on the
    // plain debounce below.
    if (visibleRatio(lastEventEl.getBoundingClientRect()) > 0.5 && e.deltaY > 0) {
      e.preventDefault();
      revealEnding();
      return;
    }
    // Backward ticks near Kaltsit (or anything while not near Kaltsit at
    // all) fall straight through to the ordinary debounce below. By this
    // point endscreenLocked is already known false (the top-of-function
    // check above would have returned otherwise), so this is always the
    // genuinely-settled case -- ordinary scrolling away from a Kaltsit
    // that was reached the normal way, nothing to do with the endscreen
    // swipe at all. Nothing here needs to check endscreenLocked itself.
    scheduleSnap();
  }
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (endscreenLocked || outroEl.classList.contains("revealed")) return;
    scheduleSnap();
  }, { passive: true });

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
      const target = snapTargets[currentIdx];
      if (!target) return;
      window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top);
    });
  });

  // Correct the initial state once in case the browser restored a non-zero
  // scroll position (back/forward navigation, a reload mid-page) — one
  // real, settled measurement taken exactly once at load, not a continuous
  // poll, same discipline as scheduleSnap's own settle check.
  applyState(snapTargets.indexOf(nearestSnapTarget()));
  updateDisplay(); // no 'scroll' event fires on load if scrollY is unchanged
})();
