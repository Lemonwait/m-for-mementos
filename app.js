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
    // for the lock's duration). It turns out no special-casing is needed:
    // .sliding-out/.sliding-in apply a CSS transform to lastEventEl, and
    // getBoundingClientRect() already reflects that transform, so this
    // function's own geometry check naturally treats it as offscreen
    // during its own swipe without being told to.
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
    lastEventEl.classList.remove("active", "leaving", "sliding-out", "sliding-in", "slide-ready");
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
  // Kaltsit and the outro, once you're already settled on Kaltsit
  // (currentIdx === kaltsitIdx): the very next forward wheel tick swipes
  // straight into the ending immediately, no wait, matching Hypergryph's
  // own reference site (Swiper.js, translateX slide, no native scrolling
  // at all) and mirroring exitEnding's already-immediate backward tick
  // below. An earlier version waited out a fixed delay parked on Kaltsit
  // before auto-revealing -- removed per explicit request: it required
  // halting the wheel to fire, which read as unresponsive compared to a
  // real Hypergryph-style tick-and-go. Both directions fully lock input
  // for their duration (endscreenLocked), matching a real Swiper
  // transition where you can't interrupt an in-flight slide.
  const SWIPE_MS = 900;
  let endscreenLocked = false;

  // Plays the CSS highlight-sweep (see .event-media.sweep in style.css)
  // once, reserved for the Kaltsit <-> outro boundary specifically, not
  // ordinary card-to-card scrolling. Removes/re-adds the class (with a
  // forced reflow in between) so a repeat trigger restarts the animation
  // instead of no-op'ing because the class was already present, then
  // cleans up afterward so it doesn't linger as dead markup.
  function triggerSweep(mediaEl) {
    if (!mediaEl) return;
    mediaEl.classList.remove("sweep");
    void mediaEl.offsetWidth;
    mediaEl.classList.add("sweep");
    setTimeout(() => mediaEl.classList.remove("sweep"), 1200);
  }

  // Forward: Kaltsit slides out to the left while the outro slides in
  // from the right, at the same time, same duration -- two panels
  // trading places, not a fade-then-scroll.
  function revealEnding() {
    endscreenLocked = true;
    applyState(kaltsitIdx);
    triggerSweep(lastEventEl.querySelector(".event-media"));
    // Deactivate whatever's ACTUALLY showing right now, not just
    // lastEventEl specifically. onWheel's trigger is a live geometry
    // check now (see below), so in practice activeSection should always
    // already be lastEventEl here -- but this is the same class of bug
    // that caused a real "card 116 bleeding through behind the endscreen,
    // counter reading 132/131" corruption: a stale/mismatched
    // activeSection left un-cleared because this only ever checked for
    // one specific element. Unconditional cleanup closes that gap for
    // good regardless of how the trigger itself is decided.
    deactivateCurrent();
    lastEventEl.classList.remove("active", "leaving");
    lastEventEl.classList.add("sliding-out");
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
    // ending is on screen (confirmed live: a fast wheel-up-then-down-fast
    // gesture right before landing on the ending left a completely
    // unrelated year, e.g. 2024, stuck lit on the rail). A first pass
    // cleared the rail entirely instead of setting it -- technically not
    // wrong, but it read as yet another inconsistent state rather than a
    // fix. Simpler and clearer: the ending stays within Kaltsit's own
    // year the whole time it's on screen, same value exitEnding restores
    // on the way back out, so nothing ever goes blank or unexplained.
    const kaltsitYear = Number(lastEventEl.dataset.year);
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === kaltsitYear));
    renderYearWatermark(kaltsitYear);
    yearWatermarkEl.classList.remove("hidden");
    setTimeout(() => {
      lastEventEl.classList.remove("sliding-out");
      endscreenLocked = false;
    }, SWIPE_MS);
  }

  // Reverse: the outro slides back out to the right while Kaltsit slides
  // back in from the left. lastEventEl is parked at translateX(-100%)
  // via .slide-ready FIRST, with a forced reflow before switching to
  // .sliding-in, so the browser registers that starting position and
  // actually animates the return trip instead of it appearing already
  // in place.
  function exitEnding() {
    endscreenLocked = true;
    outroEl.classList.remove("revealed");
    triggerSweep(lastEventEl.querySelector(".event-media"));
    lastEventEl.classList.add("slide-ready");
    void lastEventEl.offsetWidth;
    lastEventEl.classList.remove("slide-ready");
    lastEventEl.classList.add("active", "sliding-in");
    activeSection = lastEventEl;
    // Same reasoning as revealEnding's counter line: own it explicitly
    // rather than hoping a 'scroll' event will come along and fix it.
    const i = Number(lastEventEl.dataset.index);
    counterEl.textContent = `${String(i + 1).padStart(2, "0")} / ${total}`;
    const year = Number(lastEventEl.dataset.year);
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
    renderYearWatermark(year);
    yearWatermarkEl.classList.remove("hidden");
    setTimeout(() => {
      lastEventEl.classList.remove("sliding-in");
      endscreenLocked = false;
      // currentIdx never left kaltsitIdx during the whole reveal <-> exit
      // round trip (this swipe doesn't touch it), and re-entering the
      // ending is now just the next forward wheel tick's ordinary check
      // in onWheel -- no re-arming needed, there's no timer left to arm.
    }, SWIPE_MS);
  }

  function onWheel(e) {
    if (outroEl.classList.contains("revealed")) {
      // The outro is a fixed overlay sitting on top of Kaltsit's own
      // position -- without this, wheel input would scroll the page
      // underneath it while it's shown. Any backward input immediately
      // triggers the return swipe (guarded by endscreenLocked so a second
      // tick mid-animation can't re-fire it); forward input while already
      // at the end is simply absorbed.
      e.preventDefault();
      if (!endscreenLocked && e.deltaY < 0) exitEnding();
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
    //
    // endscreenLocked only guards against RE-TRIGGERING revealEnding/
    // exitEnding while one is already mid-animation -- it deliberately
    // does NOT preventDefault ordinary wheel input in general anymore. An
    // earlier version blocked ALL input for the full swipe duration
    // (endscreenLocked check at the very top of this function), which
    // read as a real stuck/frozen page if you kept wheeling backward past
    // Kaltsit right as you landed on it (confirmed live: the progress bar
    // and art both visibly froze for the lock's duration, then jumped).
    // scheduleSnap below doesn't actually conflict with the swipe
    // animation -- lastEventEl's transform is independent of real scroll
    // position, and getBoundingClientRect() already reflects that
    // transform, so updateDisplay naturally treats it as offscreen during
    // its own swipe without any special-casing.
    if (!endscreenLocked && visibleRatio(lastEventEl.getBoundingClientRect()) > 0.5 && e.deltaY > 0) {
      e.preventDefault();
      revealEnding();
      return;
    }
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
