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

    const videoHtml = m.video
      ? `<div class="yt-frame" data-yt-id="${escapeAttr(m.video.id)}" data-yt-start="${m.video.start}"${
          m.video.end ? ` data-yt-end="${m.video.end}"` : ""
        }>
          <button class="yt-load-btn" type="button" aria-label="Load video">
            <span class="yt-load-icon"></span>
            <span class="yt-load-label">LOAD VIDEO</span>
          </button>
        </div>`
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

  // ---- click-to-load YouTube background (only cards with m.video) ----
  // Same pattern arknights.wiki.gg uses for its embeds: nothing loads until
  // a real click. That's a genuine user gesture, which sidesteps browser
  // autoplay policy entirely (not just the muted-autoplay allowance) and
  // avoids the pile of intermittent failures scroll-triggered autoplay hit
  // in testing (Error 153, "video unavailable", ad-blocker/Shields
  // interference) — trading the ambient "plays as you scroll to it" effect
  // for something that reliably works. Plain <iframe src="...">, not the JS
  // IFrame Player API: that API loads a separate script
  // (youtube.com/iframe_api) which ad blockers/privacy shields commonly
  // block outright since it's the tracking-capable player API.
  function buildYoutubeSrc(holder) {
    const { ytId } = holder.dataset;
    // Matches arknights.wiki.gg's own embed exactly: just autoplay=1, no
    // mute/controls=0/loop/playlist/start/end/rel. Their player isn't muted
    // either — it doesn't need to be, since the iframe is only ever created
    // inside a real click handler (a genuine user gesture), which browsers
    // treat as permission for autoplay with sound, not just muted autoplay.
    // This drops the trimmed/looping/chromeless ambient-background effect
    // in favor of matching a pattern already proven reliable on the wiki —
    // a full, normal, controllable embedded video once you click to load it.
    return `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1`;
  }

  function mountVideo(holder) {
    if (holder.querySelector("iframe")) return;

    holder.querySelector(".yt-load-btn")?.remove();

    const iframe = document.createElement("iframe");
    iframe.src = buildYoutubeSrc(holder);
    iframe.title = "Video";
    iframe.allow = "autoplay; encrypted-media; fullscreen";
    iframe.allowFullscreen = true;
    iframe.setAttribute("frameborder", "0");
    // Error 153 is YouTube refusing to init the player when it sees no
    // referrer on the request — explicit here in case a browser's privacy
    // shields were stripping it by default despite a real http(s) origin.
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.addEventListener("load", () => {
      holder.closest(".event-media")?.classList.add("video-ready");
    });
    holder.appendChild(iframe);
    // No click-blocking shield this time: with real YouTube controls now
    // visible (no controls=0), the visitor should actually be able to use
    // them — pause, seek, volume, fullscreen — same as on the wiki.
  }

  document.querySelectorAll(".yt-load-btn").forEach((btn) => {
    btn.addEventListener("click", () => mountVideo(btn.closest(".yt-frame")));
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
    const enteringKaltsit = idx === kaltsitIdx && currentIdx !== kaltsitIdx;
    currentIdx = idx;
    outroEl.classList.toggle("revealed", target === outroEl);
    // Stamped here, at the one discrete moment currentIdx actually becomes
    // Kaltsit — not by watching geometry for an "arrival" crossing.
    if (enteringKaltsit) lastCardArrivedAt = performance.now();
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
    if (endscreenLocked) return; // don't fight the forced transition's own fade
    let best = null;
    let bestRatio = 0.5;
    document.querySelectorAll(".event").forEach((el) => {
      const r = visibleRatio(el.getBoundingClientRect());
      if (r > bestRatio) {
        bestRatio = r;
        best = el;
      }
    });

    if (best !== activeSection) {
      deactivateCurrent();
      if (best) {
        best.classList.remove("leaving");
        best.classList.add("active");
        activeSection = best;
      }
    }

    if (best) {
      const i = Number(best.dataset.index);
      const year = Number(best.dataset.year);
      counterEl.textContent = `${String(i + 1).padStart(2, "0")} / ${total}`;
      Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
      renderYearWatermark(year);
      yearWatermarkEl.classList.remove("hidden");
    } else {
      yearWatermarkEl.classList.add("hidden");
      Object.values(yearButtons).forEach((btn) => btn.classList.remove("active"));
      // Past the last card (heading toward/at the outro) reads one past
      // total ("132 / 131") rather than repeating Kaltsit's own count;
      // before the first card (still in the hero) reads "00".
      const rect = outroEl.getBoundingClientRect();
      counterEl.textContent =
        rect.top < window.innerHeight ? `${total + 1} / ${total}` : `00 / ${total}`;
    }
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
  const snapTargets = [document.getElementById("hero"), ...document.querySelectorAll(".event"), outroEl].filter(
    Boolean
  );
  const lastEventEl = [...document.querySelectorAll(".event")].pop();
  const kaltsitIdx = snapTargets.indexOf(lastEventEl);
  const outroIdx = snapTargets.indexOf(outroEl);

  // A guaranteed, fixed-duration scroll — not native scrollIntoView's
  // smooth behavior, whose actual duration varies with distance and isn't
  // fully under our control. This always takes exactly `duration`ms and
  // always finishes precisely at the target, however far away it starts.
  function smoothScrollTo(targetY, duration) {
    const startY = window.scrollY;
    const delta = targetY - startY;
    const startTime = performance.now();
    function ease(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out cubic
    }
    function step(now) {
      const elapsed = Math.min((now - startTime) / duration, 1);
      window.scrollTo(0, startY + delta * ease(elapsed));
      if (elapsed < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

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
  // threshold, tuned to roughly 2 wheel ticks on real hardware.
  const SNAP_COMMIT_PX = 70;

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
      let targetIdx =
        Math.abs(delta) <= SNAP_COMMIT_PX ? gestureStartIdx : snapTargets.indexOf(nearestSnapTarget());
      // The ONLY place a forward move can land past Kaltsit is here, and
      // only after motion has genuinely stopped (this whole callback only
      // runs once wheel/touch input has been idle for 500ms) — so this
      // clamp can't be raced by scroll speed the way a mid-scroll geometry
      // check could. However fast or far a single continuous gesture that
      // started at or before Kaltsit ends up going, it settles AT Kaltsit,
      // never past it — reaching the outro always requires a separate,
      // later gesture through the dedicated endscreen gate below.
      if (gestureStartIdx <= kaltsitIdx && targetIdx > kaltsitIdx) targetIdx = kaltsitIdx;
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

  // ---- endscreen dead-end: hard exception to "never block scroll" ----
  // Everywhere else on this page, scrolling is deliberately never
  // intercepted — that's the whole point of the debounced snap above. The
  // last card is explicitly different: it should never budge at all from
  // ordinary scrolling, right up until a real gesture commits it — and
  // once committed, nothing should be able to interrupt the 1s slide into
  // place. That needs actual preventDefault()-based capture, not just a
  // debounce.
  const LAST_CARD_HOLD_MS = 5000;
  let endscreenGestureY = 0;
  let endscreenLocked = false;
  let lastCardArrivedAt = 0;

  // Fades the last card out over the SAME duration as the forced scroll,
  // instead of the generic 650ms deactivateCurrent() uses for ordinary
  // card-to-card moves. .event-media's own CSS transition is only 0.4s —
  // with a 1000ms scroll+reveal, that let the art go fully invisible
  // ~600ms before the outro had actually arrived/finished revealing,
  // which is what "endscreen sometimes goes full dark" actually was: a
  // real gap where neither side had anything to show yet. Overriding the
  // transition-duration inline for just this one fade keeps it matched;
  // reverting it afterward leaves ordinary transitions at their normal
  // (faster) speed.
  function fadeOutMatched(section, duration) {
    if (!section) return;
    const media = section.querySelector(".event-media");
    const body = section.querySelector(".event-body");
    [media, body].forEach((el) => el && (el.style.transitionDuration = `${duration}ms`));
    section.classList.remove("active");
    section.classList.add("leaving");
    if (activeSection === section) activeSection = null;
    setTimeout(() => {
      section.classList.remove("leaving");
      [media, body].forEach((el) => el && (el.style.transitionDuration = ""));
    }, duration);
  }

  function runEndscreenTransition() {
    endscreenLocked = true;
    // activeSection is guaranteed to be lastEventEl here: currentIdx can
    // only have gotten to kaltsitIdx through applyState, which sets
    // activeSection to snapTargets[kaltsitIdx] === lastEventEl in the same
    // call — no longer two independently-lagging signals that could
    // disagree about which card is actually showing.
    fadeOutMatched(activeSection || lastEventEl, 1000);
    const targetY = window.scrollY + outroEl.getBoundingClientRect().top;
    smoothScrollTo(targetY, 1000);
    applyState(outroIdx);
    setTimeout(() => {
      endscreenLocked = false;
      endscreenGestureY = 0;
    }, 1000);
  }

  // Reverse direction (outro back toward the last card) is deliberately
  // plain free scrolling — no forced animation, no lock, no hold. Only the
  // FORWARD approach to the endscreen gets the dead-stop/hold/forced-slide
  // treatment; leaving it is just like leaving any other card, handled by
  // the ordinary scheduleSnap settle above.
  //
  // Gates on currentIdx === kaltsitIdx — a plain state comparison, not a
  // geometry check. This is the whole point of the currentIdx rewrite:
  // the roadblock can never be racing scroll speed to answer "are we on
  // Kaltsit" because it isn't measuring anything — currentIdx only ever
  // changes at the discrete, already-settled moments applyState is called
  // from, and the settle callback above already guarantees a forward
  // gesture can't land past Kaltsit in one step. By the time currentIdx
  // says kaltsitIdx, that's already a completed fact, not a snapshot that
  // could be stale a moment later.
  function endscreenGate(e) {
    if (endscreenLocked) {
      e.preventDefault(); // control stays withheld until the slide finishes
      return true;
    }
    if (currentIdx !== kaltsitIdx) return false;

    // Forward only: once genuinely on the last card, block further
    // downward scrolling for a deliberate hold (5s, a pacing choice for
    // the finale, not just enough to block overshoot) before the ending
    // can trigger. Scrolling back up off the last card is left alone —
    // ordinary free scroll, same as everywhere else.
    if (e.deltaY > 0) {
      e.preventDefault();
      if (performance.now() - lastCardArrivedAt < LAST_CARD_HOLD_MS) return true;
      // Cancel any snapTimer left pending from BEFORE the last card became
      // active — otherwise it can still fire later (up to 500ms after
      // whatever wheel event started it) and unconditionally re-apply
      // whatever it resolves to, potentially fighting this gate's own
      // transition. That race — two separate code paths both able to
      // touch state — was the actual "2 outros" behavior from earlier.
      clearTimeout(snapTimer);
      snapTimer = null;
      endscreenGestureY += e.deltaY;
      if (endscreenGestureY > SNAP_COMMIT_PX) runEndscreenTransition();
      return true;
    }
    return false;
  }

  function onWheel(e) {
    if (endscreenGate(e)) return; // endscreen owns this event — general snap never runs
    endscreenGestureY = 0;
    scheduleSnap();
  }
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchmove", scheduleSnap, { passive: true });

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
