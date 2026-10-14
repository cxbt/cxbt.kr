// The ♪ beside the site title: a plain link to /music/ that this script turns into a scene change.
// The note reacts, hollows into an outline on its way to the centre and swells like a doorway, wiping the
// page down to its background (the music room shares it), then the browser navigates; /music/ sees the session flag and plays its own entrance (layouts/music/baseof.html).

(() => {
  "use strict";
  const link = document.querySelector("[data-music-note]");
  if (!link) return;

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const done = (a, ms) => Promise.race([a.finished.catch(() => {}), new Promise(r => setTimeout(r, ms + 120))]);
  const HEAD = { x: 7.9 / 24, y: 18.1 / 24, r: 3.15 / 24 };
  let leaving = false;

  // warm the music page while the pointer is on its way
  let prefetched = false;
  const prefetch = () => {
    if (prefetched) return;
    prefetched = true;
    const l = document.createElement("link");
    l.rel = "prefetch"; l.href = link.href;
    document.head.append(l);
  };
  link.addEventListener("pointerenter", prefetch);
  link.addEventListener("focus", prefetch);

  link.addEventListener("click", async e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem("cxbt:music-enter", "1"); } catch {}
    if (reduced()) { location.href = link.href; return; }

    const r = link.getBoundingClientRect(), W = innerWidth, H = innerHeight, k = r.width / 24;
    const inner = link.querySelector("svg").innerHTML;
    const scene = document.createElement("div");
    scene.className = "scene";
    // the note lives in a full-screen SVG and is transformed as geometry, so it stays sharp at 200×
    scene.innerHTML = `<svg class="scene__svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><g class="scene__note"><g transform="translate(${r.left} ${r.top}) scale(${k})">${inner}</g></g></svg>`;
    const note = scene.querySelector(".scene__note");
    const hx = r.left + r.width * HEAD.x, hy = r.top + r.height * HEAD.y;
    const dx = W / 2 - hx, dy = H / 2 - hy;
    const big = Math.hypot(W, H) / 2 / (r.height * HEAD.r) * 1.3;
    const mid = Math.min(7, Math.max(4, W / 160));
    const color = getComputedStyle(link).color;
    note.style.transformOrigin = `${hx}px ${hy}px`;
    note.style.color = color;
    // the music room follows this page's theme, so the note empties into the shared background colour
    const roomBg = getComputedStyle(document.body).backgroundColor;
    note.style.stroke = color;
    note.style.strokeWidth = "1.5";
    note.querySelectorAll("path").forEach(p => p.setAttribute("vector-effect", "non-scaling-stroke"));
    document.body.append(scene);
    link.classList.add("is-launching");

    const T = 1750;
    const move = note.animate([
      { transform: "translate(0,0) rotate(0deg) scale(1)", easing: "cubic-bezier(.4,0,.3,1)" },
      { transform: "translate(0,0) rotate(4deg) scale(.9)", offset: .1, easing: "cubic-bezier(.4,0,.3,1)" },       // 1. reacts
      { transform: "translate(0,0) rotate(-3deg) scale(1.15)", offset: .22, easing: "cubic-bezier(.45,0,.25,1)" },
      { transform: `translate(${dx}px,${dy}px) rotate(-6deg) scale(${mid})`, offset: .58, easing: "cubic-bezier(.7,0,.85,.4)" }, // 2. hollows, to the centre
      { transform: `translate(${dx}px,${dy}px) rotate(10deg) scale(${big})` }                                       // 3. swells like a doorway
    ], { duration: T, fill: "forwards" });
    note.animate([{ color }, { color, offset: .2 }, { color: roomBg, offset: .5 }, { color: roomBg }], { duration: T, fill: "forwards" });
    await done(move, T);
    scene.style.background = roomBg;                                                                               // 4. a clean page
    location.href = link.href;
  });

  // back from /music/ through its white note: the cover already matched this page, so the note just lands
  try {
    if (sessionStorage.getItem("cxbt:music-leave")) {
      sessionStorage.removeItem("cxbt:music-leave");
      if (!reduced()) {
        link.animate([{ opacity: 0, transform: "scale(.6) rotate(-8deg)" }, { opacity: 1, transform: "none" }],
          { duration: 900, delay: 150, easing: "cubic-bezier(.25,.7,.2,1)", fill: "backwards" });
      }
    }
  } catch {}

  // returning through the back/forward cache: clear the scene this page left behind when it navigated
  addEventListener("pageshow", e => {
    if (!e.persisted) return;
    document.querySelectorAll(".scene").forEach(s => s.remove());
    link.classList.remove("is-launching");
    leaving = false;
  });
})();
