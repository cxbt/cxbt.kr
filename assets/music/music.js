// cxbt.kr /music/ — the record room.
// The page arrives with one album already rendered by Hugo (layouts/partials/music/*). This script
// measures the screen, spins the record, steps through the catalog in place (updating the address to
// /music/<album>/), flips the record into the YouTube player, and plays the scene change back home.

(() => {
  "use strict";
  const room = document.getElementById("room");
  if (!room) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const deck = $("#deck");
  const live = $("#live");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPIN_SECONDS = 45;
  const HOME = room.dataset.home || "/";

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // resolve on the animation's end, or on a timer if the page is not painting frames (background tab)
  const done = (a, ms) => Promise.race([a.finished.catch(() => {}), new Promise(r => setTimeout(r, ms + 120))]);
  const say = msg => { if (!live) return; live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 30); };
  const NOTE_INNER = ($(".note-btn svg") || {}).innerHTML || "";
  const NOTE_HEAD = { x: 7.9 / 24, y: 18.1 / 24, r: 3.15 / 24 };

  /* ───────────── catalog ───────────── */
  const state = { all: [], list: [], idx: -1, cur: null };
  const catalog = fetch(room.dataset.catalog, { credentials: "same-origin" })
    .then(r => (r.ok ? r.json() : []))
    .catch(() => [])
    .then(all => {
      state.all = Array.isArray(all) ? all : [];
      state.list = state.all.filter(a => a.inLibrary);
      const id = room.dataset.current;
      state.cur = state.all.find(a => a.id === id) || null;
      state.idx = state.list.findIndex(a => a.id === id);
    });

  /* ───────────── rendering (mirrors the Hugo partials) ───────────── */
  function stageHTML(a) {
    const m = a.media;
    const img = a.cover ? `<img class="lp__art" src="${esc(a.cover)}" alt="${esc(a.title)} 앨범 커버가 인쇄된 픽처 디스크" width="1080" height="1080" decoding="async" draggable="false" referrerpolicy="no-referrer">` : "";
    const disc = `<div class="lp"><div class="lp__disc">${img}<span class="lp__grooves"></span></div><span class="lp__sheen"></span><span class="lp__hole"></span></div>`;
    return `<div class="flip" id="flip">
      <div class="face face--front" id="front">${m
        ? `<button type="button" class="lp-btn" id="lpBtn" aria-label="${esc(a.title)} 대표 트랙 플레이어 열기">${disc}</button>`
        : `<div class="lp-btn" aria-disabled="true">${disc}</div>`}</div>
      ${m ? `<section class="face face--back player" id="player" aria-label="YouTube 플레이어" inert>
        <div class="player__screen"><div class="player__slot" id="ytSlot"></div></div>
        <div class="player__bar">
          <span class="player__track">${m.track ? `<b>${esc(m.track)}</b> · ` : ""}YouTube</span>
          <button type="button" class="btn-ghost" id="backBtn"><span aria-hidden="true">◐</span> LP로 돌아가기</button>
          <a class="player__ext" href="https://www.youtube.com/watch?v=${esc(m.videoId)}" target="_blank" rel="noopener">YouTube ↗</a>
        </div>
        <div class="bside" aria-hidden="true"></div>
      </section>` : ""}
    </div>`;
  }
  function sleeveHTML(a) {
    const n = a.note;
    return `<header class="sleeve__head">
        <div class="title-row"><a class="note-btn note-btn--room" href="${esc(HOME)}" data-back-note aria-label="cxbt.kr 홈으로 돌아가기" title="home"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${NOTE_INNER}</svg></a><h2 class="album-title">${esc(a.title)}</h2></div>
        <p class="album-artist">${esc((a.artists || []).join(", "))}${a.year ? `<span class="album-year">${esc(a.year)}</span>` : ""}</p>
      </header>
      ${a.inLibrary ? "" : `<p class="removed-note">YouTube Music 보관함에서 제거된 앨범입니다. 기록은 그대로 남겨 둡니다.</p>`}
      ${n ? `<section class="sleeve__note" aria-label="개인 코멘터리">
        <div class="commentary__head"><div class="commentary__meta"><span>${esc(n.updated)}</span></div></div>
        <div class="essay-scroll" tabindex="0" aria-label="코멘터리 본문"><div class="essay">${n.html}</div>${n.labels && n.labels.length ? `<ul class="tags" aria-label="태그">${n.labels.map(t => `<li>#${esc(t)}</li>`).join("")}</ul>` : ""}</div>
      </section>` : ""}`;
  }
  function setHint() {
    const hint = $("#hint"), a = state.cur;
    if (!hint || !a) return;
    if (isOpen) { hint.className = "play-hint"; hint.innerHTML = `<span class="dot" aria-hidden="true"></span>플레이어를 닫으면 재생이 멈춥니다 · Esc`; return; }
    hint.className = "play-hint" + (a.media ? "" : " is-off");
    hint.innerHTML = a.media
      ? `<span class="dot" aria-hidden="true"></span>레코드를 눌러 재생`
      : `<span class="dot" aria-hidden="true"></span>대표 영상 미지정 · <a href="${esc(a.ytm)}" target="_blank" rel="noopener">YouTube Music ↗</a>`;
  }
  function setArrows() {
    const n = state.list.length;
    if (n < 2) return;
    const i = state.idx < 0 ? 0 : state.idx;
    const prev = state.list[state.idx < 0 ? n - 1 : (i - 1 + n) % n], next = state.list[state.idx < 0 ? 0 : (i + 1) % n];
    const p = $(".arrow--prev"), q = $(".arrow--next");
    if (p) { p.href = prev.url; p.setAttribute("aria-label", `이전 레코드: ${prev.title}`); }
    if (q) { q.href = next.url; q.setAttribute("aria-label", `다음 레코드: ${next.title}`); }
  }
  function fill(a) {
    state.cur = a;
    state.idx = state.list.indexOf(a);
    room.dataset.current = a.id;
    $("#stage").innerHTML = stageHTML(a);
    $("#sleeve").innerHTML = sleeveHTML(a);
    isOpen = false;
    deck.classList.remove("is-playing");
    setHint();
    setArrows();
    document.title = `${a.title} · music · cxbt.kr`;
    if (a.url && location.pathname !== a.url) history.replaceState(null, "", a.url);
    layout();
    startSpin();
  }

  /* ───────────── geometry ───────────── */
  // wide: band across the screen, record left, notes right · stack: record on top, notes below
  function layout() {
    const W = deck.clientWidth, H = deck.clientHeight;
    const stack = W < 760 || W / H < 1.05;
    deck.classList.toggle("is-stack", stack);
    let D, ax, ay, pw;
    if (!stack) { D = Math.min(H * .64, W * .30); ax = W * .24; ay = H * .5; pw = Math.max(300, Math.min(640, W * .36)); }
    else { D = Math.min(W * .72, H * .36); ax = W / 2; pw = W - 32; }
    D = Math.round(D);
    const screen = Math.max(200, Math.round(pw * 9 / 16)); // YouTube: embedded player viewport ≥ 200×200
    const bar = $(".player__bar", deck)?.offsetHeight || 0;
    const ph = screen + bar;
    const zone = Math.max(D, ph); // the record and the opened player share this space, so nothing below moves
    if (stack) ay = zone / 2 + Math.max(18, H * .045);
    const v = { "--dh": H, "--zone": zone, "--D": D, "--ax": ax, "--ay": ay, "--pw": pw, "--ph": ph, "--sw": Math.max(D, pw), "--sh": Math.max(D, ph), "--band-h": Math.round(D / (stack ? 1.5 : 1.28)) };
    for (const k in v) deck.style.setProperty(k, Math.round(v[k]) + "px");
    return { D, pw, ph, screen };
  }

  /* ───────────── spin (Web Animations, so it can coast to a stop and spin back up) ───────────── */
  let spin = null, isOpen = false, busy = false, yt = null, mountToken = 0;
  function startSpin() {
    spin?.cancel(); spin = null;
    const disc = $("#stage .lp__disc");
    if (!disc || reduced()) return;
    spin = disc.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: SPIN_SECONDS * 1000, iterations: Infinity });
    spin.currentTime = Math.random() * SPIN_SECONDS * 1000;
    if (document.hidden) spin.pause();
  }
  rampSpin.id = 0;
  function rampSpin(to, ms) {
    const id = ++rampSpin.id;
    return new Promise(fin => {
      if (!spin) return fin();
      const from = spin.playbackRate, t0 = performance.now();
      if (to > 0 && spin.playState === "paused") spin.play();
      const step = t => {
        const k = Math.min(1, (t - t0) / ms), e = k * k * (3 - 2 * k);
        if (!spin || id !== rampSpin.id) return fin();
        spin.playbackRate = from + (to - from) * e;
        if (k < 1) requestAnimationFrame(step); else { if (to === 0) spin.pause(); fin(); }
      };
      requestAnimationFrame(step);
      setTimeout(() => { if (spin && id === rampSpin.id) { spin.playbackRate = to; if (to === 0) spin.pause(); } fin(); }, ms + 250);
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (!spin || isOpen) return;
    if (document.hidden) spin.pause(); else if (spin.playbackRate > 0) spin.play();
  });

  /* ───────────── stepping through the collection: the record rolls out, the next rolls in ───────────── */
  async function step(dir) {
    if (busy || isOpen) return;
    await catalog;
    const n = state.list.length;
    if (n < 2 && !(n === 1 && state.idx < 0)) return;
    busy = true;
    const stage = $("#stage"), sleeve = $("#sleeve");
    deck.classList.add("is-busy");
    setPeek(0);
    const next = state.idx < 0 ? (dir > 0 ? 0 : n - 1) : (state.idx + dir + n) % n;
    const far = Math.round(innerWidth * .32);
    if (!reduced()) {
      const out = stage.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${-dir * far}px) rotate(${-dir * 110}deg)`, opacity: 0 }],
        { duration: 900, easing: "cubic-bezier(.45,0,.75,.35)", fill: "forwards" });
      const fadeOut = sleeve.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: "ease-out", fill: "forwards" });
      await done(out, 900);
      fill(state.list[next]);
      out.cancel(); fadeOut.cancel();
      const inn = stage.animate([{ transform: `translateX(${dir * far}px) rotate(${dir * 110}deg)`, opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 1400, easing: "cubic-bezier(.2,.6,.15,1)", fill: "backwards" });
      sleeve.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 500, easing: "ease-in-out", fill: "backwards" });
      await done(inn, 1400);
    } else {
      fill(state.list[next]);
    }
    deck.classList.remove("is-busy");
    busy = false;
    const a = state.cur;
    say(`${a.title}, ${(a.artists || []).join(", ")}`);
  }

  /* ───────────── flip → player ───────────── */
  const FLIP_MS = 1650, FLIP_EASE = "cubic-bezier(.55,.05,.25,1)";
  const box = (w, h, rad) => ({ width: w + "px", height: h + "px", marginLeft: -w / 2 + "px", marginTop: -h / 2 + "px", borderRadius: rad + "px" });

  async function openPlayer() {
    if (busy || isOpen) return;
    await catalog;
    const media = state.cur?.media;
    if (!media) return;
    busy = true;
    const flip = $("#flip"), back = $("#player"), bside = $(".bside", back), front = $("#front");
    setPeek(0);
    deck.classList.add("is-playing");                            // arrows step aside
    const { D, pw, ph } = layout();
    if (!reduced()) {
      await rampSpin(0, 1200);                                    // 1. coast to a stop
      const opts = { duration: FLIP_MS, easing: FLIP_EASE, fill: "forwards" };
      const anims = [
        flip.animate([                                            // 2. turn over on the Y axis, lifting toward the viewer
          { transform: "translateZ(0) rotateY(0deg)" },
          { transform: "translateZ(60px) rotateY(90deg)", offset: .5 },
          { transform: "translateZ(0) rotateY(180deg)" }], opts),
        back.animate([box(D, D, D / 2), { ...box(D, D, D / 2), offset: .5 }, box(pw, ph, 10)], opts), // 3. the B-side opens into a panel
        bside.animate([{ opacity: 1 }, { opacity: 1, offset: .62 }, { opacity: 0 }], opts)
      ];
      await done(anims[0], FLIP_MS);
      flip.classList.add("is-open");
      anims.forEach(a => a.cancel());
    } else {
      flip.classList.add("is-open");
    }
    isOpen = true; busy = false;
    front.inert = true; back.inert = false;
    setHint();
    mountPlayer(media);                                           // 4. the real iframe only after the motion ends
    $("#backBtn").focus({ preventScroll: true });
    say("YouTube 플레이어가 열렸습니다. 재생 버튼을 눌러 들을 수 있습니다.");
  }

  async function closePlayer() {
    if (busy || !isOpen) return;
    busy = true;
    destroyPlayer();                                              // 1. stop and remove the iframe first: no audio after this
    const flip = $("#flip"), back = $("#player"), bside = $(".bside", back), front = $("#front");
    const { D, pw, ph } = layout();
    back.inert = true;
    flip.classList.remove("is-open");
    if (!reduced()) {
      const opts = { duration: FLIP_MS, easing: FLIP_EASE, fill: "both" };
      const anims = [
        flip.animate([
          { transform: "translateZ(0) rotateY(180deg)" },
          { transform: "translateZ(60px) rotateY(90deg)", offset: .5 },
          { transform: "translateZ(0) rotateY(0deg)" }], opts),
        back.animate([box(pw, ph, 10), { ...box(D, D, D / 2), offset: .5 }, box(D, D, D / 2)], opts),
        bside.animate([{ opacity: 0 }, { opacity: 1, offset: .38 }, { opacity: 1 }], opts)
      ];
      await done(anims[0], FLIP_MS);
      anims.forEach(a => a.cancel());
    }
    isOpen = false; busy = false;
    front.inert = false;
    deck.classList.remove("is-playing");
    setHint();
    $("#lpBtn")?.focus({ preventScroll: true });
    say("플레이어를 닫았습니다.");
    if (spin) { spin.playbackRate = 0; await rampSpin(1, 1800); } // 4. spin back up
  }

  /* YouTube IFrame Player API, loaded on the first open only */
  function loadYT() {
    if (window.YT?.Player) return Promise.resolve(true);
    loadYT.p ??= new Promise(res => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(true); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api"; s.async = true; s.onerror = () => res(false);
      document.head.append(s);
      setTimeout(() => res(!!window.YT?.Player), 8000);
    });
    return loadYT.p;
  }
  function fallback(msg, media) {
    return `<div class="yt-ph"><strong>${esc(msg)}</strong>
      <a href="https://www.youtube.com/watch?v=${esc(media.videoId)}" target="_blank" rel="noopener">YouTube에서 열기 ↗</a></div>`;
  }
  async function mountPlayer(media) {
    const slot = $("#ytSlot"), token = ++mountToken;
    slot.innerHTML = `<div class="yt-ph"><span>플레이어 불러오는 중…</span></div>`;
    const ok = await loadYT();
    if (token !== mountToken || !isOpen) return;
    if (!ok) { slot.innerHTML = fallback("YouTube 플레이어를 불러오지 못했습니다.", media); return; }
    const host = document.createElement("div");
    slot.replaceChildren(host);
    yt = new YT.Player(host, {
      host: "https://www.youtube-nocookie.com", videoId: media.videoId, width: "100%", height: "100%",
      playerVars: {
        autoplay: 0, playsinline: 1, rel: 0, origin: location.origin,
        ...(Number.isFinite(media.start) && { start: media.start }),
        ...(Number.isFinite(media.end) && { end: media.end })
      },
      events: {
        onError: e => {
          if (token !== mountToken) return;
          const why = e.data === 101 || e.data === 150 ? "이 영상은 다른 사이트에서 재생할 수 없습니다." : e.data === 100 ? "영상을 찾을 수 없습니다." : "재생할 수 없는 영상입니다.";
          destroyPlayer(true);
          const s = $("#ytSlot"); if (s) s.innerHTML = fallback(why, media);
        }
      }
    });
  }
  function destroyPlayer(keepToken) {
    if (!keepToken) mountToken++;
    try { yt?.stopVideo?.(); } catch {}
    try { yt?.destroy?.(); } catch {}
    yt = null;
    const slot = $("#ytSlot"); if (slot) slot.innerHTML = "";
  }

  /* ───────────── edge peek, clicks, keys, swipe ───────────── */
  function edgeOf(e) {
    if (isOpen || busy || state.list.length < 2 && state.idx >= 0) return 0;
    const r = deck.getBoundingClientRect(), x = e.clientX - r.left;
    if (e.clientY < r.top || e.clientY > r.bottom) return 0;
    const D = parseFloat(deck.style.getPropertyValue("--D")) || 0, ax = parseFloat(deck.style.getPropertyValue("--ax")) || r.width / 2;
    const zone = Math.max(56, Math.min(r.width * .16, ax - D / 2 - 12)); // stops short of the record, which plays on click
    return x < zone ? -1 : x > r.width - zone ? 1 : 0;
  }
  function setPeek(dir) {
    if (String(dir || "") === (deck.dataset.peek || "")) return;
    deck.dataset.peek = dir || "";
    deck.classList.toggle("is-peeking", !!dir);
    deck.style.setProperty("--peek", reduced() || !dir ? "0px" : `${-dir * Math.round(Math.min(20, innerWidth * .013))}px`);
  }
  document.addEventListener("pointermove", e => { if (e.pointerType === "mouse") setPeek(edgeOf(e)); });
  document.addEventListener("pointerleave", () => setPeek(0));

  let swiped = false;
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target.closest("button, a");
    if (t?.matches("[data-back-note]")) { e.preventDefault(); goHome(t); return; }
    if (t?.matches("[data-step]")) { e.preventDefault(); step(+t.dataset.step); return; }
    if (t?.id === "lpBtn") { if (!swiped) openPlayer(); return; }
    if (t?.id === "backBtn") { closePlayer(); return; }
    if (t || e.target.closest(".sleeve, .player, .lp-btn")) return;
    const dir = edgeOf(e);
    if (dir) step(dir);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isOpen) { closePlayer(); return; }
    if (isOpen || e.altKey || e.metaKey || e.ctrlKey || e.target.closest?.("input, textarea, select")) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(e.key === "ArrowLeft" ? -1 : 1); }
  });
  let sx = 0, sy = 0, sid = null;
  deck.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") { sx = e.clientX; sy = e.clientY; sid = e.pointerId; } });
  deck.addEventListener("pointerup", e => {
    if (e.pointerId !== sid) return;
    sid = null;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !isOpen) {
      swiped = true; setTimeout(() => { swiped = false; }, 50);
      step(dx < 0 ? 1 : -1);
    }
  });
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!busy) layout(); }, 80); });

  /* ───────────── scene change back home: the white note swells to the home page's colour ───────────── */
  function homeBg() {
    let pref = "auto";
    try { pref = localStorage.getItem("nostyleplease-appearance") || "auto"; } catch {}
    const dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    return dark ? "#000000" : "#ffffff";
  }
  async function goHome(btn) {
    if (busy) return;
    busy = true;
    destroyPlayer();
    const href = btn.getAttribute("href") || HOME;
    const bg = homeBg();
    try { sessionStorage.setItem("cxbt:music-leave", "1"); } catch {}
    if (reduced()) { location.href = href; return; }

    const r = btn.getBoundingClientRect(), W = innerWidth, H = innerHeight, k = r.width / 24;
    const scene = document.createElement("div");
    scene.className = "scene";
    scene.innerHTML = `<svg class="scene__svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><g class="scene__note"><g transform="translate(${r.left} ${r.top}) scale(${k})">${NOTE_INNER}</g></g></svg>`;
    const note = $(".scene__note", scene);
    const hx = r.left + r.width * NOTE_HEAD.x, hy = r.top + r.height * NOTE_HEAD.y;
    const dx = W / 2 - hx, dy = H / 2 - hy;
    const big = Math.hypot(W, H) / 2 / (r.height * NOTE_HEAD.r) * 1.3;
    const mid = Math.min(7, Math.max(4, W / 160));
    note.style.transformOrigin = `${hx}px ${hy}px`;
    note.style.color = getComputedStyle(btn).color;
    // a black note would vanish into the black room, so on a dark home it carries a hairline edge
    if (bg === "#000000") note.style.cssText += ";stroke:rgba(255,255,255,.55);stroke-width:1";
    $$("path", note).forEach(p => p.setAttribute("vector-effect", "non-scaling-stroke"));
    document.body.append(scene);
    btn.classList.add("is-launching");
    const T = 1750;
    const move = note.animate([
      { transform: "translate(0,0) rotate(0deg) scale(1)", easing: "cubic-bezier(.4,0,.3,1)" },
      { transform: "translate(0,0) rotate(-4deg) scale(.9)", offset: .1, easing: "cubic-bezier(.4,0,.3,1)" },
      { transform: "translate(0,0) rotate(3deg) scale(1.15)", offset: .22, easing: "cubic-bezier(.45,0,.25,1)" },
      { transform: `translate(${dx}px,${dy}px) rotate(6deg) scale(${mid})`, offset: .58, easing: "cubic-bezier(.7,0,.85,.4)" },
      { transform: `translate(${dx}px,${dy}px) rotate(-10deg) scale(${big})` }
    ], { duration: T, fill: "forwards" });
    const c0 = note.style.color;
    note.animate([{ color: c0 }, { color: c0, offset: .25 }, { color: bg, offset: .55 }, { color: bg }], { duration: T, fill: "forwards" });
    await done(move, T);
    scene.style.background = bg;
    location.href = href;
  }
  // coming back with the browser's back/forward cache: clear any scene left over from leaving
  addEventListener("pageshow", e => {
    if (!e.persisted) return;
    $$(".scene").forEach(s => s.remove());
    $$(".is-launching").forEach(b => b.classList.remove("is-launching"));
    busy = false;
  });

  /* ───────────── boot ───────────── */
  if (!$("#stage")) return; // nothing synced yet: the empty state needs no motion
  layout();
  startSpin();
  if (root.classList.contains("is-entering")) setTimeout(() => root.classList.remove("is-entering"), 3400);
  catalog.then(setArrows);
})();
