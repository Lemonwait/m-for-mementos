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
      if (target) target.scrollIntoView({ behavior: "smooth" });
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
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          if (activeSection && activeSection !== entry.target) {
            deactivateCurrent();
          }
          entry.target.classList.remove("leaving");
          entry.target.classList.add("active");
          activeSection = entry.target;

          const idx = Number(entry.target.dataset.index);
          const year = Number(entry.target.dataset.year);
          counterEl.textContent = `${String(idx + 1).padStart(2, "0")} / ${total}`;
          Object.entries(yearButtons).forEach(([y, btn]) => {
            btn.classList.toggle("active", Number(y) === year);
          });
          renderYearWatermark(year);
          yearWatermarkEl.classList.remove("hidden");
        }
      });
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
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          deactivateCurrent();
          yearWatermarkEl.classList.add("hidden");
          counterEl.textContent = `${entry.target.id === "hero" ? "00" : String(total).padStart(2, "0")} / ${total}`;
          Object.values(yearButtons).forEach((btn) => btn.classList.remove("active"));
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
    document.getElementById("events").scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("top-btn").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- gentle snap-to-card once scrolling has actually settled ----
  // Deliberately not native CSS scroll-snap: that reacts on every scroll
  // tick, which is exactly what makes a fast scroll feel interrupted. This
  // only evaluates once real wheel/touch input has been idle for a beat —
  // so a fast wheel-spree never gets nudged mid-motion, only the resting
  // position gets aligned once you've actually stopped.
  const snapTargets = [
    document.getElementById("hero"),
    ...document.querySelectorAll(".event"),
    document.getElementById("outro"),
  ].filter(Boolean);

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
      let targetIdx = gestureStartIdx;
      if (Math.abs(delta) > SNAP_COMMIT_PX) {
        targetIdx =
          delta > 0
            ? Math.min(gestureStartIdx + 1, snapTargets.length - 1)
            : Math.max(gestureStartIdx - 1, 0);
      }
      const target = snapTargets[targetIdx];
      if (target && Math.abs(target.getBoundingClientRect().top) > 4) {
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
  window.addEventListener("wheel", scheduleSnap, { passive: true });
  window.addEventListener("touchmove", scheduleSnap, { passive: true });
})();
