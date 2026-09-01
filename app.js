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
        currentTarget = target;
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

  // ---- active section tracking (counter, year rail, and which card's
  // fixed art layer is showing) ----
  // Exactly one .event ever gets .active at a time — tracked explicitly in
  // JS (not left to CSS/layout), which is what guarantees only one art
  // layer is ever visible: the previous active card's class is removed in
  // the same tick the new one's is added, so there's no window where two
  // could both be considered "active."
  let activeSection = null;
  // Tracks WHICH slide is logically current, independent of scroll pixels
  // — see the resize listener near the bottom of this file for why that
  // distinction matters. Updated at every point the code already decides
  // "we've navigated to X" (observers noticing a crossing, year-rail
  // clicks, the endscreen transitions, the general snap system landing).
  let currentTarget = document.getElementById("hero");
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

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      // The forced endscreen scroll (last card <-> outro) animates straight
      // through this observer's own thresholds, so its callback fires mid
      // -transition regardless of who triggered the scroll. Left unguarded,
      // it would reassert .active/counter/watermark on whatever card the
      // animated scroll is passing over, fighting the explicit fade
      // fadeOutMatched()/runEndscreenTransition() just set up — the same
      // "two independent systems touching shared state" shape that caused
      // the earlier 2-outros bug. The lock already means this scroll isn't
      // real user navigation, so this observer has nothing useful to say
      // until it's over.
      if (endscreenLocked) return;
      // A fast scroll (or a year-rail jump across many cards) can cross
      // several cards' 50% threshold within the same observer callback —
      // entries aren't guaranteed to be reported in scroll/visual order,
      // so applying each qualifying one in raw array order let an
      // earlier, less-visible card "win" last and briefly flash its
      // (older) year back onto the watermark before the correct one
      // reasserted itself. Always trust whichever qualifying entry is
      // actually most visible right now, not just whichever came last.
      const qualifying = entries.filter((e) => e.isIntersecting && e.intersectionRatio > 0.5);
      if (qualifying.length === 0) return;
      const entry = qualifying.reduce((best, e) => (e.intersectionRatio > best.intersectionRatio ? e : best));

      if (activeSection && activeSection !== entry.target) {
        deactivateCurrent();
      }
      entry.target.classList.remove("leaving");
      entry.target.classList.add("active");
      activeSection = entry.target;
      currentTarget = entry.target;
      // Safety net: a real .event becoming active means we're definitely
      // not looking at the outro anymore, regardless of which path (gate
      // or general snap fallback) got us here. See the matching add-side
      // safety net in boundaryObserver below for why this can't just be
      // left to the two dedicated endscreen-transition functions alone.
      outroEl.classList.remove("revealed");

      const idx = Number(entry.target.dataset.index);
      const year = Number(entry.target.dataset.year);
      counterEl.textContent = `${String(idx + 1).padStart(2, "0")} / ${total}`;
      Object.entries(yearButtons).forEach(([y, btn]) => {
        btn.classList.toggle("active", Number(y) === year);
      });
      renderYearWatermark(year);
      yearWatermarkEl.classList.remove("hidden");
    },
    { threshold: [0.5] }
  );
  document.querySelectorAll(".event").forEach((sec) => sectionObserver.observe(sec));

  // ---- clear the active card entirely once scrolled into hero or outro ----
  // sectionObserver above only reacts when a NEW .event crosses 50% — it
  // never explicitly turns anything off when you scroll away from every
  // event at once (back up into the hero, or on past the last card into
  // the outro). Without this, the last-active card's fixed art/text just
  // stayed on screen indefinitely, bleeding into hero/outro and making
  // those look unchanged or cluttered instead of being their own clean
  // page — this is what actually fixes that, not a scroll-position issue.
  const boundaryEls = [document.getElementById("hero"), document.getElementById("outro")].filter(
    Boolean
  );
  const boundaryObserver = new IntersectionObserver(
    (entries) => {
      if (endscreenLocked) return; // same reason as sectionObserver's guard above
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          deactivateCurrent();
          currentTarget = entry.target;
          yearWatermarkEl.classList.add("hidden");
          counterEl.textContent = `${entry.target.id === "hero" ? "00" : String(total).padStart(2, "0")} / ${total}`;
          Object.values(yearButtons).forEach((btn) => btn.classList.remove("active"));
          // Safety net, add-side: a fast/large scroll can jump clean over
          // the last card's whole viewport window between two wheel
          // samples, so endscreenGate's isNearLastCard() check never fires
          // true for any single event — the scroll falls through entirely
          // to the general snap system, which can land squarely on the
          // outro (nearestSnapTarget picks it, scrollIntoView lands on it)
          // without ever running through runEndscreenTransition(), the
          // only place that used to add "revealed". That's the actual
          // "dead-stop skipped, straight into a dark screen" bug: outro
          // fully in view, but never marked revealed, so its text/button
          // stayed at opacity:0. This observer fires off real final
          // geometry regardless of which path got us here, so tying
          // "revealed" to it directly (rather than only to the two
          // dedicated gate functions) closes the gap for good, however
          // large a single scroll jump was.
          if (entry.target === outroEl) outroEl.classList.add("revealed");
        }
      });
    },
    { threshold: [0.5] }
  );
  boundaryEls.forEach((el) => boundaryObserver.observe(el));

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
    const firstEvent = document.querySelector(".event");
    if (firstEvent) currentTarget = firstEvent;
    document.getElementById("events").scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("top-btn").addEventListener("click", () => {
    currentTarget = document.getElementById("hero");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- gentle snap-to-card once scrolling has actually settled ----
  // Deliberately not native CSS scroll-snap: that reacts on every scroll
  // tick, which is exactly what makes a fast scroll feel interrupted. This
  // only evaluates once real wheel/touch input has been idle for a beat —
  // so a fast wheel-spree never gets nudged mid-motion, only the resting
  // position gets aligned once you've actually stopped.
  const outroEl = document.getElementById("outro");
  const snapTargets = [document.getElementById("hero"), ...document.querySelectorAll(".event"), outroEl].filter(
    Boolean
  );

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
  // threshold, tuned to roughly 2 wheel ticks on real hardware. Two rounds
  // of guessing the real per-tick pixel size (200px, then 120px) both
  // still needed 3 real ticks to clear — dropping with more real margin
  // this time instead of inching down again.
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
      // fire-time — not capped at ±1 from the start index. That cap was
      // the actual bug behind "snaps 20 events back": one long continuous
      // scroll (no 500ms pause anywhere in it) doesn't fire the debounce
      // until the very end, by which point the real scroll position could
      // be many cards past gestureStartIdx — snapping to "1 step from
      // where it started" meant jumping backward across everything
      // already scrolled past, instead of just settling where it lands.
      const targetIdx =
        Math.abs(delta) <= SNAP_COMMIT_PX ? gestureStartIdx : snapTargets.indexOf(nearestSnapTarget());
      const target = snapTargets[targetIdx];
      if (target) currentTarget = target;
      if (target && Math.abs(target.getBoundingClientRect().top) > 4) {
        outroEl.classList.remove("revealed"); // leaving the endscreen
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
  // ordinary scrolling (not even a partial reveal of the outro creeping
  // in), right up until 2 ticks commits it — and once committed, nothing
  // should be able to interrupt the 1s slide into place. That needs
  // actual preventDefault()-based capture, not just a debounce.
  const lastEventEl = [...document.querySelectorAll(".event")].pop();
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
    currentTarget = outroEl;
    fadeOutMatched(lastEventEl, 1000);
    yearWatermarkEl.classList.add("hidden");
    const targetY = window.scrollY + outroEl.getBoundingClientRect().top;
    smoothScrollTo(targetY, 1000);
    outroEl.classList.add("revealed");
    setTimeout(() => {
      endscreenLocked = false;
      endscreenGestureY = 0;
    }, 1000);
  }

  // Reverse direction (outro back to the last card) gets the same forced,
  // fixed-duration, fully-locked treatment. Does NOT wait for
  // sectionObserver to notice naturally — that only fires once the scroll
  // has ALREADY brought lastEventEl past 50% visible, which for a 1000ms
  // scroll can happen quite late. That gap (art still opacity:0 well past
  // the transition's halfway point while outro had already faded down)
  // was the actual "blank black on fast wheel" — the lock stops outside
  // interference, but never fixed this internal timing gap on its own.
  // Activating the last card immediately, in the same tick the reverse
  // starts, closes it — same principle as the forward direction
  // immediately revealing the outro rather than waiting on a threshold.
  function runReverseEndscreenTransition() {
    endscreenLocked = true;
    currentTarget = lastEventEl;
    const outroLine = outroEl.querySelector(".outro-line");
    const outroBtn = outroEl.querySelector(".pill-btn");
    [outroLine, outroBtn].forEach((el) => el && (el.style.transitionDuration = "1000ms"));
    outroEl.classList.remove("revealed");

    lastEventEl.classList.remove("leaving");
    lastEventEl.classList.add("active");
    activeSection = lastEventEl;
    const idx = Number(lastEventEl.dataset.index);
    const year = Number(lastEventEl.dataset.year);
    counterEl.textContent = `${String(idx + 1).padStart(2, "0")} / ${total}`;
    Object.entries(yearButtons).forEach(([y, btn]) => btn.classList.toggle("active", Number(y) === year));
    renderYearWatermark(year);
    yearWatermarkEl.classList.remove("hidden");
    lastCardArrivedAt = performance.now();

    const targetY = window.scrollY + lastEventEl.getBoundingClientRect().top;
    smoothScrollTo(targetY, 1000);
    setTimeout(() => {
      [outroLine, outroBtn].forEach((el) => el && (el.style.transitionDuration = ""));
      endscreenLocked = false;
      endscreenGestureY = 0;
    }, 1000);
  }

  // Returns true if this wheel event belongs to the endscreen gate (and
  // has already been fully handled — caller must not also run the general
  // snap system for it). Returns false for every other case, meaning the
  // event is the general snap system's to handle, entirely separately.
  // Live geometry, not activeSection — activeSection only updates via
  // IntersectionObserver, which batches/reports asynchronously and can lag
  // well behind a fast, continuous scroll. Ordinary (non-last) cards never
  // call preventDefault at all, so during a genuinely fast multi-second
  // scroll across many cards, the raw scroll position could blow straight
  // past the last card and into the outro zone before the observer ever
  // got a chance to report "you've arrived" — the gate never engaged
  // because it was waiting on a signal that hadn't caught up yet. This
  // reads the actual current position directly, every time, so there's no
  // lag possible: true the instant any part of the last card is in the
  // viewport, well before it's fully "arrived," giving real margin to
  // catch a fast scroll before it can escape past it.
  let wasNearLastCard = false;
  function isNearLastCard() {
    const rect = lastEventEl.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  function endscreenGate(e) {
    if (endscreenLocked) {
      e.preventDefault(); // control stays withheld until the slide finishes
      return true;
    }
    const nearLastCard = isNearLastCard();
    if (nearLastCard && !wasNearLastCard) lastCardArrivedAt = performance.now();
    wasNearLastCard = nearLastCard;

    // Forward: only once actually near the last card, and only after a
    // 500ms cooldown from the moment it was first reached — without this,
    // a fast scroll that lands on the last card mid-momentum could carry
    // straight through into the endscreen without the user ever really
    // seeing the last card at all.
    if (nearLastCard && e.deltaY > 0) {
      e.preventDefault();
      if (performance.now() - lastCardArrivedAt < 500) return true;
      // Cancel any snapTimer left pending from BEFORE the last card became
      // active — otherwise it can still fire later (up to 500ms after
      // whatever wheel event started it) and unconditionally strip
      // .revealed off the outro, even after this gate's own dedicated
      // transition just correctly set it. That race — two separate code
      // paths both able to touch #outro's state — was the actual "2
      // outros" behavior: the class flipping on/off inconsistently.
      clearTimeout(snapTimer);
      snapTimer = null;
      endscreenGestureY += e.deltaY;
      if (endscreenGestureY > SNAP_COMMIT_PX) runEndscreenTransition();
      return true;
    }
    // Reverse: only while actually viewing the outro.
    if (outroEl.classList.contains("revealed") && e.deltaY < 0) {
      e.preventDefault();
      clearTimeout(snapTimer);
      snapTimer = null;
      endscreenGestureY += e.deltaY;
      if (endscreenGestureY < -SNAP_COMMIT_PX) runReverseEndscreenTransition();
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
  // Every card is sized with min-height:100vh, and which card is "current"
  // is ultimately read back from raw scrollY pixels against that geometry.
  // A viewport-height change — entering/exiting fullscreen, the browser
  // toolbar hiding, a window resize — changes 100vh itself, which resizes
  // every card and reflows the document's total height, all without a
  // single pixel of actual scrolling. The SAME scrollY value then falls
  // inside a completely different card than before (observed: toggling
  // fullscreen alone jumped the displayed card from 122/131 to 104/131).
  // currentTarget (set at every explicit navigation above) is the actual
  // source of truth for "what slide are we on" — re-anchoring scrollY to
  // that element's fresh position on resize keeps the visible slide
  // unchanged instead of reinterpreting a now-stale pixel offset.
  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (!currentTarget) return;
      window.scrollTo(0, window.scrollY + currentTarget.getBoundingClientRect().top);
    });
  });
})();
