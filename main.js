/* Caffeinity homepage: particle field (three.js) + scroll choreography (GSAP). */
const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger, Lenis = window.Lenis;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Particle field                                                      */
/* ------------------------------------------------------------------ */
const field = { intro: { v: 0 }, ready: false, tick() {} };

async function initField() {
  const THREE = await import('./vendor/three.module.min.js');
  const canvas = $('#gl');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  const VH = 2 * 10 * Math.tan((45 / 2) * Math.PI / 180); // world height at z=0

  const small = Math.min(innerWidth, innerHeight) < 700;
  const N = small ? 26000 : 64000;
  const TAU = Math.PI * 2, rnd = Math.random;
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;

  // --- line-segment builders: [ax,ay,az,bx,by,bz,meta]
  const star = (S, n, k, r, rot, cx, cy, z, meta = 0) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU, b = rot + ((i + k) / n) * TAU;
      S.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, cx + Math.cos(b) * r, cy + Math.sin(b) * r, z, meta]);
    }
  };
  const circle = (S, r, cx, cy, z, meta = 0, n = 64, a0 = 0, a1 = TAU) => {
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * (a1 - a0), b = a0 + ((i + 1) / n) * (a1 - a0);
      S.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, cx + Math.cos(b) * r, cy + Math.sin(b) * r, z, meta]);
    }
  };
  const sampler = (S) => {
    const cum = new Float32Array(S.length); let L = 0;
    S.forEach((s, i) => { L += Math.hypot(s[3] - s[0], s[4] - s[1], s[5] - s[2]); cum[i] = L; });
    return (out, o, jit) => {
      const r = rnd() * L; let lo = 0, hi = S.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; cum[m] < r ? lo = m + 1 : hi = m; }
      const s = S[lo], t = rnd();
      out[o] = s[0] + (s[3] - s[0]) * t + gauss() * jit;
      out[o + 1] = s[1] + (s[4] - s[1]) * t + gauss() * jit;
      out[o + 2] = s[2] + (s[5] - s[2]) * t + gauss() * jit;
      return s[6];
    };
  };

  // 1. girih rosette: nested {10/3} stars receding in depth, as in the brand mark
  const R = [];
  for (let k = 0; k < 6; k++) star(R, 10, 3, 3.1 * Math.pow(0.79, k), k * 0.157 + Math.PI / 2, 0, 0, 0.9 - k * 0.4, k);
  circle(R, 3.32, 0, 0, 0.9, 0, 120);
  circle(R, 0.42, 0, 0, -1.1, 5, 40);
  const sR = sampler(R);

  // 2. khatam floor: the eight-point star of the logo, tiled on the ground plane
  const F = [];
  for (let gx = -8; gx <= 8; gx++) for (let gz = -8; gz <= 1; gz++) {
    const cx = gx * 2, cy = gz * 2, h = 0.62;
    star(F, 4, 1, h * Math.SQRT2, Math.PI / 4, cx, cy, 0);
    star(F, 4, 1, h * Math.SQRT2, 0, cx, cy, 0);
    circle(F, 0.2, cx, cy, 0, 0, 10);
    const t = h * Math.SQRT2;
    F.push([cx + t, cy, 0, cx + 2 - t, cy, 0, 0], [cx, cy + t, 0, cx, cy + 2 - t, 0, 0]);
  }
  const sF = sampler(F);

  // 3. three rosettes: bloom (loose), extract (sharp), crema (swirl)
  const T = [[], [], []];
  star(T[0], 10, 3, 1.15, Math.PI / 2, 0, 0, 0); circle(T[0], 0.5, 0, 0, 0);
  star(T[1], 10, 3, 1.15, Math.PI / 2, 0, 0, 0); star(T[1], 10, 4, 1.15, Math.PI / 2, 0, 0, 0.2);
  star(T[1], 10, 3, 0.62, Math.PI / 2 + 0.314, 0, 0, -0.2); circle(T[1], 1.24, 0, 0, 0);
  [0.34, 0.62, 0.9, 1.18].forEach((r, i) => circle(T[2], r, 0, 0, i * 0.08));
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU * 2.5, b = ((i + 1) / 90) * TAU * 2.5, ra = 0.05 + (i / 90) * 1.1, rb = 0.05 + ((i + 1) / 90) * 1.1;
    T[2].push([Math.cos(a) * ra, Math.sin(a) * ra, 0.1, Math.cos(b) * rb, Math.sin(b) * rb, 0.1, 0]);
  }
  const sT = T.map(sampler), TX = 3.5;

  // 4. the cup: wireframe of revolution, saucer, handle, steam
  const C = [], Csteam = [];
  const ringXZ = (S, r, y, n = 48) => { for (let i = 0; i < n; i++) { const a = (i / n) * TAU, b = ((i + 1) / n) * TAU; S.push([Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(b) * r, y, Math.sin(b) * r, 0]); } };
  const prof = (t) => [0.78 + 0.62 * Math.pow(t, 0.55), -0.8 + t * 1.7]; // radius, height
  for (let i = 0; i <= 12; i++) { const [r, y] = prof(i / 12); ringXZ(C, r, y); }
  ringXZ(C, 1.4, 0.9); ringXZ(C, 1.36, 0.9);
  for (let m = 0; m < 24; m++) for (let i = 0; i < 12; i++) {
    const a = (m / 24) * TAU, [r0, y0] = prof(i / 12), [r1, y1] = prof((i + 1) / 12);
    C.push([Math.cos(a) * r0, y0, Math.sin(a) * r0, Math.cos(a) * r1, y1, Math.sin(a) * r1, 0]);
  }
  for (let i = 0; i < 5; i++) ringXZ(C, 0.25 + i * 0.26, 0.68);            // coffee surface
  [1.5, 1.85, 2.2, 2.5, 2.56].forEach((r) => ringXZ(C, r, -0.86 + (r - 1.5) * 0.12, 72)); // saucer
  for (const dz of [-0.07, 0, 0.07]) for (let i = 0; i < 24; i++) {        // handle
    const a = -1.35 + (i / 24) * 2.7, b = -1.35 + ((i + 1) / 24) * 2.7;
    C.push([1.22 + Math.cos(a) * 0.55, 0.12 + Math.sin(a) * 0.52, dz, 1.22 + Math.cos(b) * 0.55, 0.12 + Math.sin(b) * 0.52, dz, 0]);
  }
  for (let sIdx = 0; sIdx < 3; sIdx++) for (let i = 0; i < 40; i++) {
    const f = (y) => (sIdx - 1) * 0.42 + Math.sin(y * 1.9 + sIdx * 2.1) * 0.2 * (y - 0.7);
    const y0 = 1.0 + (i / 40) * 2.7, y1 = 1.0 + ((i + 1) / 40) * 2.7;
    Csteam.push([f(y0), y0, Math.cos(y0 * 1.3 + sIdx) * 0.15, f(y1), y1, Math.cos(y1 * 1.3 + sIdx) * 0.15, 1]);
  }
  const sC = sampler(C), sS = sampler(Csteam);

  // --- fill attributes
  const p0 = new Float32Array(N * 3), p1 = new Float32Array(N * 3), p2 = new Float32Array(N * 3),
        p3 = new Float32Array(N * 3), p4 = new Float32Array(N * 3), aRnd = new Float32Array(N * 4),
        aLay = new Float32Array(N), aWob = new Float32Array(N);
  const tmp = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const o = i * 3, dust = rnd() < 0.09;
    // noise cloud
    const rr = 2 + Math.pow(rnd(), 0.6) * 7.5, th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1);
    p0[o] = rr * Math.sin(ph) * Math.cos(th) * 1.5; p0[o + 1] = rr * Math.sin(ph) * Math.sin(th) * 0.8; p0[o + 2] = rr * Math.cos(ph) * 0.6 - 1;
    // rosette
    if (dust) { const a = rnd() * TAU, d = 0.5 + rnd() * 4.6; p1[o] = Math.cos(a) * d; p1[o + 1] = Math.sin(a) * d; p1[o + 2] = gauss() * 1.6; aLay[i] = (rnd() - 0.5) * 0.6; }
    else { const k = sR(p1, o, 0.013); aLay[i] = (k % 2 ? -1 : 1) * (0.35 + k * 0.2); }
    // floor (XY sample -> XZ plane)
    if (dust) { p2[o] = (rnd() - 0.5) * 30; p2[o + 1] = -1.8 + rnd() * 5.5; p2[o + 2] = -17 + rnd() * 20; }
    else { sF(tmp, 0, 0.012); p2[o] = tmp[0]; p2[o + 1] = -2.1 + gauss() * 0.01; p2[o + 2] = tmp[1]; }
    // triple
    const w = i % 3;
    if (dust) { p3[o] = (w - 1) * TX + gauss() * 1.6; p3[o + 1] = gauss() * 1.6; p3[o + 2] = gauss() * 0.8; }
    else { sT[w](p3, o, w === 0 ? 0.075 : 0.011); p3[o] += (w - 1) * TX; }
    // cup
    const steam = rnd() < 0.13;
    (steam ? sS : sC)(p4, o, steam ? 0.05 : 0.01);
    aWob[i] = steam ? 0.16 : 0.0;
    aRnd[i * 4] = rnd(); aRnd[i * 4 + 1] = rnd(); aRnd[i * 4 + 2] = rnd(); aRnd[i * 4 + 3] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  const set = (n, a, s) => geo.setAttribute(n, new THREE.BufferAttribute(a, s));
  set('position', p0, 3); set('p1', p1, 3); set('p2', p2, 3); set('p3', p3, 3); set('p4', p4, 3);
  set('aRnd', aRnd, 4); set('aLay', aLay, 1); set('aWob', aWob, 1);

  const U = {
    uStage: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uRot: { value: 0 }, uAlpha: { value: 1 },
    uS1: { value: 1 }, uS3: { value: 1 }, uS4: { value: 1 }, uFlow: { value: 0 },
    uO1: { value: new THREE.Vector3() }, uO3: { value: new THREE.Vector3() }, uO4: { value: new THREE.Vector3() },
    uMouse: { value: new THREE.Vector2(99, 99) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uStage,uTime,uPx,uRot,uAlpha,uS1,uS3,uS4,uFlow;
      uniform vec3 uO1,uO3,uO4; uniform vec2 uMouse;
      attribute vec3 p1,p2,p3,p4; attribute vec4 aRnd; attribute float aLay,aWob;
      varying vec3 vCol; varying float vA;
      mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
      float wt(float s,float i){return max(0.,1.-abs(s-i));}
      void main(){
        vec3 P0=position+vec3(sin(uTime*.31+aRnd.x*40.),cos(uTime*.27+aRnd.y*40.),sin(uTime*.2+aRnd.z*40.))*.7;
        vec3 P1=p1; P1.xy=rot(uRot*aLay)*P1.xy; P1=P1*uS1+uO1;
        vec3 P2=p2; P2.z=mod(P2.z+17.+uFlow,20.)-17.;
        vec3 P3=p3*uS3+uO3;
        vec3 P4=p4; P4.xz=rot(uTime*.22)*P4.xz; P4.yz=rot(.42)*P4.yz;
        P4.xy+=aWob*(P4.y+1.)*vec2(sin(uTime*1.2+aRnd.w*30.),cos(uTime*.9+aRnd.z*30.));
        P4=P4*uS4+uO4;
        float fl=floor(uStage),fr=uStage-fl,d=aRnd.x*.5;
        float s=fl+smoothstep(d,d+.5,fr);
        vec3 P=P0*wt(s,0.)+P1*wt(s,1.)+P2*wt(s,2.)+P3*wt(s,3.)+P4*wt(s,4.);
        float turb=sin(fract(s)*3.14159);
        P+=turb*vec3(sin(aRnd.y*50.+uTime),cos(aRnd.z*50.+uTime*.8),sin(aRnd.w*50.+uTime*.6))*1.3;
        vec2 dd=P.xy-uMouse; P.xy+=normalize(dd+1e-4)*.45*exp(-dot(dd,dd)*1.3);
        vec4 mv=modelViewMatrix*vec4(P,1.);
        gl_Position=projectionMatrix*mv;
        gl_PointSize=uPx*(.55+aRnd.y*1.5)*(10./-mv.z);
        vA=uAlpha*smoothstep(-27.,-10.,mv.z)*(.3+.7*aRnd.w);
        vec3 saffron=vec3(.92,.66,.24),cream=vec3(.95,.92,.86),lapis=vec3(.36,.66,.95);
        vCol=aRnd.z<.5?saffron:(aRnd.z<.8?cream:lapis);
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA;
      void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,.08,r)*vA;gl_FragColor=vec4(vCol,a);}`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  let W = 1, H = 1, aspect = 1, narrow = false;
  const resize = () => {
    W = innerWidth; H = innerHeight; aspect = W / H; narrow = aspect < 1;
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    U.uPx.value = dpr * (H / 900) * 2.1;
  };
  resize(); addEventListener('resize', resize);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; mouse.tx = (e.clientX / W) * 2 - 1; mouse.ty = -((e.clientY / H) * 2 - 1); mouse.on = true; });

  const anchor = (e) => { const r = e.getBoundingClientRect(), half = Math.min(r.height / 2, H * 0.3); return [r.left + r.width / 2, clamp(H * 0.52, r.top + half, Math.max(r.top + half, r.bottom - half))]; };
  const wx = (sx) => (sx / W - 0.5) * VH * aspect, wy = (sy) => (0.5 - sy / H) * VH;
  const el = { void: $('.process-void'), cup: $('.cup-space'), man: $('#manifesto'), caps: $('#capabilities'), proc: $('#process'), why: $('#why'), con: $('#contact') };
  const enter = (e, span = 0.8) => clamp((H - e.getBoundingClientRect().top) / (H * span));
  let last = performance.now(), time = 0, flow = 0, scrollRot = 0;

  field.tick = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    // skip drawing while the plaster sheet covers the viewport
    const wr = el.why.getBoundingClientRect();
    if (wr.top < -40 && wr.bottom > H + 40) return;
    if (!reduce) { time += dt; flow += dt * 0.55; }
    const worldW = VH * aspect;
    const tm = enter(el.man, 1), t12 = enter(el.caps), t23 = enter(el.proc), t34 = enter(el.con);
    U.uStage.value = field.intro.v + (field.intro.v >= 1 ? t12 + t23 + t34 : 0);
    U.uTime.value = time; U.uFlow.value = flow;
    scrollRot = lerp(scrollRot, scrollY * 0.0012, 0.08);
    U.uRot.value = time * 0.05 + scrollRot;
    // per-shape placement
    const s1 = narrow ? clamp(worldW / 7.6, 0.4, 1) : 1;
    U.uS1.value = s1 * lerp(1, 1.5, tm);
    U.uO1.value.set(narrow ? 0 : lerp(worldW * 0.25, 0, tm), narrow ? lerp(1.3, 0, tm) : lerp(0.25, 0, tm), 0);
    U.uS3.value = clamp(worldW / 11.5, 0.3, 1.1);
    const a3 = anchor(el.void); U.uO3.value.set(0, wy(a3[1]), 0);
    const a4 = anchor(el.cup); U.uS4.value = narrow ? 0.5 : 1;
    U.uO4.value.set(wx(a4[0]), wy(a4[1]) - (narrow ? 0.55 : 0.8), 0);
    const base = narrow ? 0.6 : 0.85;
    U.uAlpha.value = base * (1 - 0.62 * tm * (1 - t12)) * (1 - 0.35 * t12 * (1 - t23));
    // pointer parallax
    mouse.x = lerp(mouse.x, mouse.tx, 0.06); mouse.y = lerp(mouse.y, mouse.ty, 0.06);
    pts.rotation.y = mouse.x * 0.16; pts.rotation.x = -mouse.y * 0.1;
    camera.position.x = mouse.x * 0.35; camera.position.y = mouse.y * 0.22; camera.lookAt(0, 0, 0);
    if (mouse.on) U.uMouse.value.set(mouse.x * worldW / 2, mouse.y * VH / 2);
    renderer.render(scene, camera);
  };
  field.ready = true;
}

/* ------------------------------------------------------------------ */
/* Page choreography                                                   */
/* ------------------------------------------------------------------ */
function initPage() {
  gsap.registerPlugin(ScrollTrigger);

  // smooth scroll
  let lenis = null;
  if (!reduce && Lenis) {
    lenis = new Lenis({ lerp: 0.1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  gsap.ticker.add(() => field.tick());

  // in-page anchors
  const go = (hash) => {
    const t = $(hash); if (!t) return;
    lenis ? lenis.scrollTo(t, { duration: 1.4 }) : t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setNav(false); go(a.getAttribute('href')); }));

  // menu
  const menu = $('.menu'), nav = $('#sitenav');
  function setNav(open) {
    if (open === !nav.hidden) return;
    menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.textContent = open ? 'Close' : 'Menu';
    gsap.killTweensOf([nav, nav.children]);
    if (open) {
      nav.hidden = false; lenis && lenis.stop();
      gsap.fromTo(nav, { clipPath: 'circle(0% at 100% 0%)' }, { clipPath: 'circle(150% at 100% 0%)', duration: reduce ? 0 : 0.9, ease: 'power3.inOut' });
      gsap.fromTo(nav.children, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: reduce ? 0 : 0.7, stagger: 0.06, delay: reduce ? 0 : 0.25, ease: 'power3.out' });
    } else {
      lenis && lenis.start();
      gsap.to(nav, { clipPath: 'circle(0% at 100% 0%)', duration: reduce ? 0 : 0.6, ease: 'power3.inOut', onComplete: () => { nav.hidden = true; } });
    }
  }
  menu.addEventListener('click', () => setNav(nav.hidden));
  $$('a', nav).forEach((a) => a.addEventListener('click', () => setNav(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

  // enquiry form (same endpoint and behaviour as before)
  const form = $('#enquiry');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const d = new FormData(form), btn = $('button[type=submit]', form), st = $('#form-status');
    const fail = () => { btn.disabled = false; st.hidden = false; st.textContent = 'Could not send just now — email hello@caffeinity.com and we will pick it up there.'; };
    btn.disabled = true; st.hidden = true;
    fetch('/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: d.get('name'), company: d.get('company') || '', email: d.get('email'), message: d.get('message'), context: d.get('context') || '', hp: d.get('hp') || '' }) })
      .then((r) => r.json())
      .then((j) => { if (j.ok) form.innerHTML = '<p class="contact-alt">Thank you — your enquiry is on its way. We reply within one business day.</p>'; else fail(); })
      .catch(fail);
  });

  const initBg = () => {
  // background colour follows the section in view
  $$('[data-bg]').forEach((sec) => ScrollTrigger.create({
    trigger: sec, start: 'top 55%', end: 'bottom 55%',
    onToggle: (self) => self.isActive && gsap.to(document.body, { backgroundColor: sec.dataset.bg, duration: 0.9, overwrite: 'auto' }),
  }));
  };

  const pre = $('.pre');
  if (reduce) { initBg(); pre.style.display = 'none'; field.intro.v = 1; window.__booted = true; return; }

  // ---------- intro ----------
  const n = $('#pre-n'), count = { v: 0 };
  const heroLines = $$('.hero h1 .line>span');
  gsap.set(heroLines, { yPercent: 115 });
  gsap.set(['.hero-sub', '.hero-meta', '.top'], { opacity: 0, y: 24 });
  const tl = gsap.timeline({ onStart: () => { window.__booted = true; } });
  tl.to(count, { v: 100, duration: 1.5, ease: 'power2.inOut', onUpdate: () => { n.textContent = String(Math.round(count.v)).padStart(2, '0'); } })
    .to(pre, { yPercent: -100, duration: 0.9, ease: 'power4.inOut' })
    .set(pre, { display: 'none' })
    .to(field.intro, { v: 1, duration: 2.8, ease: 'power2.inOut' }, '-=0.9')
    .to(heroLines, { yPercent: 0, duration: 1.2, stagger: 0.1, ease: 'power4.out' }, '-=2.6')
    .to(['.hero-sub', '.hero-meta', '.top'], { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: 'power3.out' }, '-=1.9');

  // ---------- capabilities: pinned horizontal run on wide screens ----------
  const mm = gsap.matchMedia();
  mm.add('(min-width: 900px) and (min-height: 620px)', () => {
    root.classList.add('js-h');
    const track = $('.track'), bar = $('.caps-bar');
    const dist = () => track.scrollWidth - innerWidth;
    const run = gsap.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: '.caps', pin: true, scrub: 0.6, start: 'top top', end: () => '+=' + dist(), invalidateOnRefresh: true, onUpdate: (s) => bar.style.setProperty('--p', s.progress.toFixed(4)) } });
    $$('.cap').forEach((c) => {
      gsap.fromTo($('.ghost', c), { xPercent: 30 }, { xPercent: -30, ease: 'none', scrollTrigger: { trigger: c, containerAnimation: run, start: 'left right', end: 'right left', scrub: true } });
      gsap.from([$('h3', c), $('p', c), $('.chips', c), $('.more', c)], { y: 50, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: c, containerAnimation: run, start: 'left 82%' } });
    });
    return () => { root.classList.remove('js-h'); gsap.set(track, { clearProps: 'all' }); };
  });
  mm.add('(max-width: 899px), (max-height: 619px)', () => {
    $$('.cap').forEach((c) => {
      gsap.fromTo($('.ghost', c), { yPercent: 25 }, { yPercent: -25, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'bottom top', scrub: true } });
      gsap.from([$('h3', c), $('p', c), $('.chips', c), $('.more', c)], { y: 40, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: c, start: 'top 82%' } });
    });
  });

  initBg();

  // ---------- hero parallax ----------
  const hl = $$('.hero h1 .line');
  [-7, 5, -3].forEach((x, i) => gsap.to(hl[i], { xPercent: x, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } }));
  gsap.to('.hero-sub, .hero-meta', { yPercent: -40, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: '60% top', scrub: true } });

  // ---------- marquee: drifts, and leans into scroll velocity ----------
  const mq = gsap.to('.marquee-in', { xPercent: -50, duration: 26, ease: 'none', repeat: -1 });
  ScrollTrigger.create({ onUpdate: (self) => { const v = clamp(Math.abs(self.getVelocity()) / 300, 0, 6); gsap.to(mq, { timeScale: (self.direction < 0 ? -1 : 1) * (1 + v), duration: 0.3, overwrite: true }); } });

  // ---------- manifesto: words light up as you read ----------
  const split = $('.manifesto .split');
  const wrapWords = (node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach((w) => { if (!w.trim()) { f.append(w); return; } const s = document.createElement('span'); s.className = 'w'; s.textContent = w; f.append(s); });
        c.replaceWith(f);
      } else wrapWords(c);
    });
  };
  wrapWords(split);
  gsap.fromTo($$('.w', split), { opacity: 0.14 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: { trigger: '.manifesto', start: 'top 70%', end: 'bottom 75%', scrub: true } });

  // ---------- section titles rise from a mask ----------
  $$('.sec-title').forEach((h) => gsap.from($$('.line>span', h), { yPercent: 115, duration: 1.1, stagger: 0.12, ease: 'power4.out', scrollTrigger: { trigger: h, start: 'top 88%' } }));

  // ---------- process ----------
  $$('.step').forEach((s, i) => {
    gsap.fromTo(s, { '--p': 0 }, { '--p': 1, duration: 1.2, delay: i * 0.15, ease: 'power3.inOut', scrollTrigger: { trigger: '.steps', start: 'top 85%' } });
    gsap.from(s.children, { y: 40, opacity: 0, duration: 0.9, stagger: 0.07, delay: i * 0.15, ease: 'power3.out', scrollTrigger: { trigger: '.steps', start: 'top 85%' } });
  });

  // ---------- why ----------
  gsap.fromTo('.why-art', { yPercent: -18, rotate: -8 }, { yPercent: 40, rotate: 10, ease: 'none', scrollTrigger: { trigger: '.why', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.prose', { y: 50, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.prose', start: 'top 85%' } });
  gsap.from('.why-grid>div', { y: 50, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: '.why-grid', start: 'top 88%' } });

  // ---------- contact + footer ----------
  gsap.from('.form>*:not([name=hp]):not([hidden])', { y: 30, opacity: 0, duration: 0.7, stagger: 0.05, ease: 'power3.out', scrollTrigger: { trigger: '.form', start: 'top 85%' } });
  gsap.from('.giant', { yPercent: 40, ease: 'none', scrollTrigger: { trigger: 'footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });

  // ---------- pointer: cursor dot and magnetic buttons ----------
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    const cur = $('.cursor'), cx = gsap.quickTo(cur, 'x', { duration: 0.25, ease: 'power3' }), cy = gsap.quickTo(cur, 'y', { duration: 0.25, ease: 'power3' });
    addEventListener('pointermove', (e) => { cx(e.clientX); cy(e.clientY); });
    $$('a,button,input,textarea').forEach((t) => {
      t.addEventListener('pointerenter', () => gsap.to(cur, { scale: 3.4, duration: 0.3 }));
      t.addEventListener('pointerleave', () => gsap.to(cur, { scale: 1, duration: 0.3 }));
    });
    $$('.magnetic').forEach((m) => {
      m.addEventListener('pointermove', (e) => { const r = m.getBoundingClientRect(); gsap.to(m, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.4, ease: 'power3.out' }); });
      m.addEventListener('pointerleave', () => gsap.to(m, { x: 0, y: 0, duration: 0.8, ease: 'elastic.out(1,0.4)' }));
    });
  }

  addEventListener('load', () => ScrollTrigger.refresh());
  document.fonts && document.fonts.ready.then(() => ScrollTrigger.refresh());
}

initField().catch((err) => { console.warn('WebGL field unavailable:', err); root.classList.add('no-gl'); $('#gl').style.display = 'none'; });
if (gsap && ScrollTrigger) initPage();
else { $('.pre').style.display = 'none'; field.intro.v = 1; (function loop() { field.tick(); requestAnimationFrame(loop); })(); }
