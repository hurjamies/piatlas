// Three.js-näkymä oktaedrikartalle. Renderöi vain tarvittaessa (akku), näyttää näytepisteet,
// termien osumat, ankkurin, valinnan, valitun osuman merkkipolun ja polkuhaun reitin (setRoute).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { legacyMapIndex, mapIndex, Vec3 } from '../../core/mapping';
import { PickItem, pickNearest } from '../../core/pick';

export interface SceneTerm {
  id: string;
  label: string;
  color: string;
  hits: ArrayLike<number>;
  len: number;
  step: number;
}

export interface SceneData {
  terms: SceneTerm[];
  mode: 'octa' | 'legacy';
  N: number;
  showSamples: boolean;
  colorBy: 'term' | 'index';
  window: { center: number; radius: number } | null;
}

/** Polkuhaun reitin solmut järjestyksessä (π-indeksi n, koodi ja nimi). */
export interface SceneRoutePoint {
  n: number;
  code: string;
  label: string;
}

export interface SceneMarks {
  anchor: { termId: string; n: number; label: string; color: string } | null;
  selected: { termId: string; n: number; label: string; color: string; len: number; step: number } | null;
  companions: { termId: string; n: number; label: string; color: string }[];
  showPath: boolean;
}

const SAMPLE_COUNT = 24000;

function makeDiscTexture(ring = false): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  if (ring) {
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.stroke();
  } else {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.62, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pointSizeFor(count: number): number {
  if (count <= 40) return 11;
  if (count <= 400) return 7;
  if (count <= 3000) return 4.5;
  return 3;
}

export class SpaceScene {
  readonly ok: boolean = true;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private controls!: OrbitControls;
  private disc = makeDiscTexture(false);
  private ring = makeDiscTexture(true);
  private samples: THREE.Points | null = null;
  private termGroup = new THREE.Group();
  private markGroup = new THREE.Group();
  private routeGroup = new THREE.Group();
  private route: SceneRoutePoint[] | null = null;
  private routeAnchors: { key: string; p: THREE.Vector3; text: string }[] = [];
  private data: SceneData | null = null;
  private marks: SceneMarks | null = null;
  private pickItems: { termId: string; n: number; p: THREE.Vector3; r: number }[] = [];
  private labelEls = new Map<string, HTMLDivElement>();
  private labelAnchors: { key: string; p: THREE.Vector3; text: string; color: string; cls?: string }[] = [];
  private raf = 0;
  private dirty = true;
  private ro: ResizeObserver;
  private downAt: { x: number; y: number; t: number } | null = null;
  private autoRotate = false;
  private fitted = false;

  constructor(
    private host: HTMLElement,
    private labels: HTMLElement,
    private onPick: (hit: { termId: string; n: number } | null) => void,
  ) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      (this as { ok: boolean }).ok = false;
      this.ro = new ResizeObserver(() => undefined);
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x070b14, 1);
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(2.9, 2.1, 1.7);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.75;
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 14;
    this.controls.addEventListener('change', () => this.requestRender());
    this.buildOctahedron();
    this.scene.add(this.termGroup, this.markGroup, this.routeGroup);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  private buildOctahedron() {
    const V = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    const pos: number[] = [];
    const col: number[] = [];
    const tint = new THREE.Color();
    for (let bits = 0; bits < 8; bits++) {
      const sx = bits & 1 ? -1 : 1, sy = bits & 2 ? -1 : 1, sz = bits & 4 ? -1 : 1;
      pos.push(sx, 0, 0, 0, sy, 0, 0, 0, sz);
      tint.setHSL(0.5 + (bits % 4) * 0.035, 0.35, sz > 0 ? 0.42 : 0.32);
      for (let k = 0; k < 3; k++) col.push(tint.r, tint.g, tint.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const faces = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scene.add(faces);
    const e: number[] = [];
    const edges = [
      [0, 2], [2, 1], [1, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4], [0, 5], [1, 5], [2, 5], [3, 5],
    ];
    for (const [a, b] of edges) e.push(...V[a], ...V[b]);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(e, 3));
    this.scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x5b8794, transparent: true, opacity: 0.75 })));
  }

  private mapFn(n: number): Vec3 {
    const d = this.data!;
    return d.mode === 'legacy' ? legacyMapIndex(n, d.N) : mapIndex(n);
  }

  setData(d: SceneData) {
    if (!this.ok) return;
    this.data = d;
    // näytepisteet
    if (this.samples) {
      this.scene.remove(this.samples);
      this.samples.geometry.dispose();
      (this.samples.material as THREE.Material).dispose();
      this.samples = null;
    }
    if (d.showSamples && d.N > 0) {
      const M = Math.min(SAMPLE_COUNT, d.N);
      const pos = new Float32Array(M * 3);
      const col = new Float32Array(M * 3);
      const c = new THREE.Color();
      const lo = new THREE.Color('#2f5f9e');
      const hi = new THREE.Color('#f4c56b');
      for (let i = 0; i < M; i++) {
        const n = 1 + Math.floor((i * (d.N - 1)) / Math.max(1, M - 1));
        const p = this.mapFn(n);
        pos[3 * i] = p.x;
        pos[3 * i + 1] = p.y;
        pos[3 * i + 2] = p.z;
        if (d.colorBy === 'index') c.copy(lo).lerp(hi, n / d.N);
        else c.set('#8aa3b8');
        col[3 * i] = c.r;
        col[3 * i + 1] = c.g;
        col[3 * i + 2] = c.b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.samples = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          size: 2,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          opacity: d.colorBy === 'index' ? 0.55 : 0.3,
          depthWrite: false,
        }),
      );
      this.scene.add(this.samples);
    }
    // termien osumat
    for (const ch of [...this.termGroup.children]) {
      this.termGroup.remove(ch);
      const pts = ch as THREE.Points;
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    }
    this.pickItems = [];
    const ordered = [...d.terms].sort((a, b) => b.hits.length - a.hits.length); // harvinaiset päällimmäisiksi
    for (const t of ordered) {
      const ns: number[] = [];
      for (let i = 0; i < t.hits.length; i++) {
        const n = t.hits[i];
        if (d.window && Math.abs(n - d.window.center) > d.window.radius) continue;
        ns.push(n);
      }
      if (!ns.length) continue;
      const size = pointSizeFor(t.hits.length);
      const pos = new Float32Array(ns.length * 3);
      ns.forEach((n, i) => {
        const p = this.mapFn(n);
        pos[3 * i] = p.x;
        pos[3 * i + 1] = p.y;
        pos[3 * i + 2] = p.z;
        this.pickItems.push({ termId: t.id, n, p: new THREE.Vector3(p.x, p.y, p.z), r: size / 2 });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({
        size: size * (this.renderer.getPixelRatio() > 1 ? 1 : 1),
        sizeAttenuation: false,
        map: this.disc,
        color: new THREE.Color(t.color),
        transparent: true,
        alphaTest: 0.3,
        depthWrite: false,
      });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = 10 + (1000000 - t.hits.length) / 1e6;
      this.termGroup.add(pts);
    }
    if (this.marks) this.setMarks(this.marks);
    if (this.route) this.buildRoute();
    this.requestRender();
  }

  /**
   * Polkuhaun reitti: viiva mapIndex-pisteiden kautta ja numeroidut merkit 1…k. Ei vaikuta osumien valintaan
   * (pickItems tulee vain hakutermeistä). null poistaa reitin.
   */
  setRoute(points: SceneRoutePoint[] | null) {
    if (!this.ok) return;
    this.route = points && points.length ? points : null;
    this.buildRoute();
  }

  private buildRoute() {
    for (const ch of [...this.routeGroup.children]) {
      this.routeGroup.remove(ch);
      const o = ch as THREE.Mesh;
      o.geometry?.dispose();
      (o.material as THREE.Material)?.dispose?.();
    }
    this.routeAnchors = [];
    if (this.route && this.data) {
      const pts = this.route.map((r) => {
        const q = this.mapFn(r.n);
        return new THREE.Vector3(q.x, q.y, q.z);
      });
      if (pts.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: new THREE.Color('#f4c56b'), transparent: true, opacity: 0.95, depthTest: false }),
        );
        line.renderOrder = 60;
        this.routeGroup.add(line);
      }
      const marks = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, map: this.disc, color: new THREE.Color('#f4c56b'), transparent: true, depthTest: false }),
      );
      marks.renderOrder = 61;
      this.routeGroup.add(marks);
      pts.forEach((p, i) => this.routeAnchors.push({ key: `route:${i}`, p, text: String(i + 1) }));
    }
    this.syncLabelEls();
    this.requestRender();
  }

  setMarks(m: SceneMarks) {
    if (!this.ok) return;
    this.marks = m;
    if (!this.data) return;
    for (const ch of [...this.markGroup.children]) {
      this.markGroup.remove(ch);
      const o = ch as THREE.Mesh;
      o.geometry?.dispose();
      (o.material as THREE.Material)?.dispose?.();
    }
    this.labelAnchors = [];
    const addRing = (n: number, color: string, size: number, key: string, text: string) => {
      const p = this.mapFn(n);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([p.x, p.y, p.z], 3));
      const pts = new THREE.Points(
        g,
        new THREE.PointsMaterial({ size, sizeAttenuation: false, map: this.ring, color: new THREE.Color(color), transparent: true, depthTest: false }),
      );
      pts.renderOrder = 50;
      this.markGroup.add(pts);
      this.labelAnchors.push({ key, p: new THREE.Vector3(p.x, p.y, p.z), text, color });
    };
    for (const c of m.companions) addRing(c.n, c.color, 20, `c:${c.termId}:${c.n}`, `${c.label} · ${fmt(c.n)}`);
    if (m.anchor) addRing(m.anchor.n, m.anchor.color, 28, 'anchor', `⚓ ${m.anchor.label} · ${fmt(m.anchor.n)}`);
    const sel = m.selected;
    if (sel && !(m.anchor && sel.termId === m.anchor.termId && sel.n === m.anchor.n)) {
      addRing(sel.n, '#ffffff', 30, 'sel', `${sel.label} · ${fmt(sel.n)}`);
      if (m.anchor) {
        const a = this.mapFn(m.anchor.n), b = this.mapFn(sel.n);
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
        const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xe6eef3, dashSize: 0.03, gapSize: 0.025, transparent: true, opacity: 0.8, depthTest: false }));
        line.computeLineDistances();
        line.renderOrder = 40;
        this.markGroup.add(line);
      }
    } else if (sel) {
      // valittu = ankkuri: korostetaan rengasta
      addRing(sel.n, '#ffffff', 34, 'sel-ring', '');
    }
    if (sel && m.showPath && sel.len > 1) {
      const ptsArr: THREE.Vector3[] = [];
      for (let i = 0; i < sel.len; i++) {
        const p = this.mapFn(sel.n + i * sel.step);
        ptsArr.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      const g = new THREE.BufferGeometry().setFromPoints(ptsArr);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(sel.color), transparent: true, opacity: 0.9, depthTest: false }));
      line.renderOrder = 45;
      this.markGroup.add(line);
      const pg = new THREE.BufferGeometry().setFromPoints(ptsArr);
      const pp = new THREE.Points(pg, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, map: this.disc, color: new THREE.Color(sel.color), transparent: true, depthTest: false }));
      pp.renderOrder = 46;
      this.markGroup.add(pp);
      ptsArr.forEach((p, i) =>
        this.labelAnchors.push({ key: `path:${i}`, p, text: `${i + 1}`, color: sel.color, cls: 'path' }),
      );
    }
    this.syncLabelEls();
    this.requestRender();
  }

  setAutoRotate(on: boolean) {
    if (!this.ok) return;
    this.autoRotate = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.6;
    this.requestRender();
  }

  /** Etäisyys, jolla koko oktaedri (säde 1 + nimilaput) mahtuu näkymään. */
  private fitDistance(): number {
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const aspect = Math.max(0.2, this.camera.aspect);
    return Math.max(3.0, 1.16 / (Math.tan(half) * Math.min(1, aspect)));
  }

  resetCamera() {
    if (!this.ok) return;
    this.camera.position.set(2.9, 2.1, 1.7).setLength(this.fitDistance());
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.requestRender();
  }

  focusOn(n: number) {
    if (!this.ok || !this.data) return;
    const p = this.mapFn(n);
    const dir = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const dist = this.camera.position.length();
    this.camera.position.copy(dir.multiplyScalar(Math.max(2.4, dist)));
    this.camera.position.z += 0.35;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.requestRender();
  }

  private syncLabelEls() {
    const keep = new Set<string>();
    const axis: { key: string; p: THREE.Vector3; text: string }[] = [
      { key: 'ax:+x', p: new THREE.Vector3(1.13, 0, 0), text: '+X' },
      { key: 'ax:-x', p: new THREE.Vector3(-1.13, 0, 0), text: '−X' },
      { key: 'ax:+y', p: new THREE.Vector3(0, 1.13, 0), text: '+Y' },
      { key: 'ax:-y', p: new THREE.Vector3(0, -1.13, 0), text: '−Y' },
      { key: 'ax:+z', p: new THREE.Vector3(0, 0, 1.12), text: '+Z' },
      { key: 'ax:-z', p: new THREE.Vector3(0, 0, -1.12), text: '−Z' },
    ];
    for (const a of axis) {
      keep.add(a.key);
      this.ensureLabel(a.key, a.text, '', 'axis');
    }
    for (const l of this.labelAnchors) {
      if (!l.text) continue;
      keep.add(l.key);
      this.ensureLabel(l.key, l.text, l.color, l.cls);
    }
    for (const r of this.routeAnchors) {
      keep.add(r.key);
      this.ensureLabel(r.key, r.text, '', 'route');
    }
    for (const [k, el] of this.labelEls) {
      if (!keep.has(k)) {
        el.remove();
        this.labelEls.delete(k);
      }
    }
  }

  private ensureLabel(key: string, text: string, color: string, cls?: string) {
    let el = this.labelEls.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'label3d' + (cls ? ` ${cls}` : '');
      this.labels.appendChild(el);
      this.labelEls.set(key, el);
    }
    if (el.textContent !== text) el.textContent = text;
    if (cls === 'path') {
      el.style.transform = 'translate(-50%, -50%)';
      el.style.padding = '0 4px';
      el.style.fontSize = '10px';
    }
    el.style.color = color || '';
    el.style.borderColor = color ? color + '88' : '';
  }

  private updateLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    const place = (key: string, p: THREE.Vector3) => {
      const el = this.labelEls.get(key);
      if (!el) return;
      v.copy(p).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = v.z > 1 ? '0' : '1';
    };
    place('ax:+x', new THREE.Vector3(1.13, 0, 0));
    place('ax:-x', new THREE.Vector3(-1.13, 0, 0));
    place('ax:+y', new THREE.Vector3(0, 1.13, 0));
    place('ax:-y', new THREE.Vector3(0, -1.13, 0));
    place('ax:+z', new THREE.Vector3(0, 0, 1.12));
    place('ax:-z', new THREE.Vector3(0, 0, -1.12));
    for (const l of this.labelAnchors) place(l.key, l.p);
    for (const r of this.routeAnchors) place(r.key, r.p);
    // Nimilaput eivät saa peittää toisiaan: siirretään ylöspäin.
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const l of this.labelAnchors) {
      if (l.cls === 'path' || !l.text) continue;
      const el = this.labelEls.get(l.key);
      if (!el) continue;
      const w0 = el.offsetWidth, h0 = el.offsetHeight;
      const cx = parseFloat(el.style.left), cy = parseFloat(el.style.top);
      let top = cy - 1.3 * h0;
      const left = cx - w0 / 2;
      for (let guard = 0; guard < 6; guard++) {
        const hit = boxes.find((b) => left < b.x + b.w && left + w0 > b.x && top < b.y + b.h && top + h0 > b.y);
        if (!hit) break;
        top = hit.y - h0 - 3;
      }
      boxes.push({ x: left, y: top, w: w0, h: h0 });
      el.style.top = `${top + 1.3 * h0}px`;
    }
  }

  requestRender() {
    if (!this.ok) return;
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    const moving = this.controls.update();
    if (this.dirty || moving || this.autoRotate) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    }
    if (moving || this.autoRotate) this.raf = requestAnimationFrame(this.frame);
  };

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // kapealla näytöllä kauemmas, jotta koko oktaedri mahtuu
    this.camera.fov = w < h ? 46 : 36;
    this.camera.updateProjectionMatrix();
    if (!this.fitted && w > 1 && h > 1) {
      this.fitted = true;
      this.camera.position.setLength(this.fitDistance());
      this.controls.update();
    }
    this.requestRender();
  }

  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const hit = this.pickAt(e.clientX - rect.left, e.clientY - rect.top);
    this.onPick(hit);
  };

  /** Napautus näyttökoordinaateissa → lähin osuma. */
  pickAt(x: number, y: number): { termId: string; n: number } | null {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    const items: PickItem[] = this.pickItems.map((it) => {
      v.copy(it.p).project(this.camera);
      return { termId: it.termId, n: it.n, sx: (v.x * 0.5 + 0.5) * w, sy: (-v.y * 0.5 + 0.5) * h, r: it.r, depth: v.z };
    });
    const best = pickNearest(items, x, y, 22);
    return best ? { termId: best.termId, n: best.n } : null;
  }

  /** Osuman näyttökoordinaatit (testejä ja ohjeita varten). */
  screenOf(n: number): { x: number; y: number } | null {
    if (!this.ok || !this.data) return null;
    const p = this.mapFn(n);
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight };
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    if (!this.ok) return;
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.disc.dispose();
    this.ring.dispose();
    this.renderer.dispose();
    el.remove();
    for (const l of this.labelEls.values()) l.remove();
  }
}

function fmt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
