import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { City } from '../world/city';
import type { Quality } from '../ui/ui';

interface Level {
  pixelRatio: number;
  shadow: number;
  shadowRange: number;
  fogNear: number;
  fogFar: number;
  traffic: number;
  peds: number;
  normalMaps: boolean;
}

export const LEVELS: Record<Quality, Level> = {
  baja: { pixelRatio: 1, shadow: 0, shadowRange: 0, fogNear: 140, fogFar: 800, traffic: 14, peds: 12, normalMaps: false },
  media: { pixelRatio: 1.5, shadow: 1024, shadowRange: 60, fogNear: 240, fogFar: 1500, traffic: 22, peds: 26, normalMaps: true },
  alta: { pixelRatio: 2, shadow: 2048, shadowRange: 95, fogNear: 320, fogFar: 2600, traffic: 30, peds: 40, normalMaps: true },
};

/** Renderer, camera, sky and sun. */
export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 1, 3000);
  sun = new THREE.DirectionalLight(0xfff0dc, 6);
  level: Level = LEVELS.alta;
  private sunDir = new THREE.Vector3(-0.62, 0.55, 0.42).normalize();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    // Shadow support stays on in the renderer; quality levels only switch the sun's shadow.
    this.renderer.shadowMap.enabled = true;

    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);

    // Ambient light and reflections come from a plain sky gradient. The physical sky above is
    // far too bright to use directly: it would drown the sun and hide every shadow.
    const dome = new THREE.SphereGeometry(50, 32, 16);
    const dp = dome.attributes.position;
    const dc = new Float32Array(dp.count * 3);
    const zenith = [0.75, 1.0, 1.55];
    const horizon = [1.45, 1.55, 1.65];
    const ground = [0.5, 0.47, 0.42];
    for (let i = 0; i < dp.count; i++) {
      const t = dp.getY(i) / 50;
      const to = t > 0 ? zenith : ground;
      const k = t > 0 ? Math.sqrt(t) : Math.min(1, -t * 5);
      for (let j = 0; j < 3; j++) dc[i * 3 + j] = horizon[j] + (to[j] - horizon[j]) * k;
    }
    dome.setAttribute('color', new THREE.BufferAttribute(dc, 3));
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();

    const haze = new THREE.Color(0xb7cbdc);
    this.scene.fog = new THREE.Fog(haze, 300, 2600);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.level.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: Quality, city: City) {
    const L = (this.level = LEVELS[q]);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = L.fogNear;
    fog.far = L.fogFar;
    this.camera.far = L.fogFar + 150;
    const shadows = L.shadow > 0;
    this.sun.castShadow = shadows;
    if (shadows) {
      const sh = this.sun.shadow;
      if (sh.mapSize.x !== L.shadow) {
        sh.mapSize.set(L.shadow, L.shadow);
        sh.map?.dispose();
        sh.map = null;
      }
      const c = sh.camera;
      c.left = c.bottom = -L.shadowRange;
      c.right = c.top = L.shadowRange;
      c.near = 1;
      c.far = 500;
      c.updateProjectionMatrix();
    }
    for (const n of city.normalMapped) {
      const want = L.normalMaps ? n.normal : null;
      if (n.mat.normalMap !== want) {
        n.mat.normalMap = want;
        n.mat.needsUpdate = true;
      }
    }
    this.resize();
  }

  /** Keeps the shadow box centred on the taxi, snapped to texels to avoid shimmer. */
  followSun(x: number, y: number, z: number) {
    const step = this.level.shadowRange ? (this.level.shadowRange * 2) / this.level.shadow : 1;
    const sx = Math.round(x / step) * step;
    const sz = Math.round(z / step) * step;
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx + this.sunDir.x * 220, y + this.sunDir.y * 220, sz + this.sunDir.z * 220);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
