import * as THREE from 'three';
import { GameAudio } from './audio/audio';
import { angDiff, clamp, damp } from './core/math';
import { es } from './i18n/es';
import { Input } from './input/input';
import { Mission } from './mission/mission';
import { Mode } from './mission/scoring';
import { View } from './render/view';
import { Pedestrians, Traffic } from './traffic/traffic';
import { Minimap } from './ui/minimap';
import { Quality, Ui } from './ui/ui';
import { Car } from './vehicle/car';
import { TaxiModel, buildTaxi } from './vehicle/models';
import { City, buildCity } from './world/city';
import { nearestRoad, offsetPoint, roads } from './world/roads';
import { ROAD_Y, groundHeight } from './world/terrain';
import { buildTextures, setAnisotropy } from './world/textures';

type State = 'menu' | 'playing' | 'paused' | 'results';
const PHYS_DT = 1 / 120;

export class Game {
  private ui = new Ui();
  private view: View;
  private city: City;
  private car = new Car();
  private taxi: TaxiModel;
  private traffic: Traffic;
  private peds: Pedestrians;
  private mission: Mission;
  private input: Input;
  private audio = new GameAudio();
  private minimap: Minimap;
  private arrow: THREE.Group;
  private arrowMat: THREE.MeshBasicMaterial;
  private arrowInner!: THREE.Mesh;
  private blob: THREE.Mesh;

  private state: State = 'menu';
  private mode: Mode = 'normal';
  private quality: Quality = 'alta';
  private last = 0;
  private clock = 0;
  private camHeading = 0;
  private camPos = new THREE.Vector3();
  private shake = 0;
  private crashCooldown = 0;
  private resetCooldown = 0;
  private mapTimer = 0;
  private pitch = 0;
  private roll = 0;
  private prevForward = 0;
  private dive = 0;
  // Frame-rate watch for automatic quality.
  private fpsTime = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.view = new View(canvas);
    setAnisotropy(Math.min(8, this.view.renderer.capabilities.getMaxAnisotropy()));
    const tex = buildTextures();
    this.city = buildCity(tex);
    this.view.scene.add(this.city.group);

    this.taxi = buildTaxi();
    this.view.scene.add(this.taxi.root);

    this.input = new Input(canvas, this.ui.touchRoot);
    this.traffic = new Traffic(this.view.scene, {
      nearMiss: () => this.mission.nearMiss(),
      hit: () => {},
    });
    this.peds = new Pedestrians(this.view.scene);
    this.mission = new Mission(this.view.scene, this.city.places, tex.glow, {
      toast: (t, k) => this.ui.toast(t, k),
      say: (t) => this.ui.say(t),
      sound: (n) => this.audio.play(n),
    });
    this.minimap = new Minimap(this.ui.minimap);

    // Guidance arrow floating over the taxi.
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x3dff7a, fog: false, transparent: true, opacity: 0.95 });
    this.arrow = new THREE.Group();
    const shape = new THREE.Shape();
    const outline = [[0, 1.2], [0.75, 0.15], [0.28, 0.15], [0.28, -0.9], [-0.28, -0.9], [-0.28, 0.15], [-0.75, 0.15]];
    outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    const arrowGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
    arrowGeo.rotateX(Math.PI / 2);
    this.arrowMat.toneMapped = false;
    this.arrowInner = new THREE.Mesh(arrowGeo, this.arrowMat);
    this.arrow.add(this.arrowInner);
    this.arrow.rotation.order = 'YXZ';
    this.arrow.scale.setScalar(1.25);
    this.view.scene.add(this.arrow);

    // Soft dark disc under the taxi for when real shadows are off.
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(1.2, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.scale.set(1, 1.8, 1);
    this.view.scene.add(this.blob);

    this.ui.onStart = (m) => this.start(m);
    this.ui.onResume = () => this.resume();
    this.ui.onRestart = () => this.start(this.mode);
    this.ui.onQuit = () => this.toMenu();
    this.ui.onPause = () => this.pause();
    this.ui.onReset = () => this.resetToRoad();
    this.ui.onGesture = () => this.audio.unlock();
    this.ui.onSettings = () => this.applySettings();
    this.input.onPause = () => (this.state === 'playing' ? this.pause() : this.state === 'paused' ? this.resume() : 0);
    this.input.onReset = () => this.resetToRoad();
    this.input.onHorn = () => this.state === 'playing' && this.audio.play('horn');
    document.addEventListener('visibilitychange', () => document.hidden && this.pause());

    this.placeAtStart();
    this.applySettings();
    this.camHeading = this.car.heading;
    this.ui.hideLoading();
    this.ui.show('menu');
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings() {
    const s = this.ui.settings;
    this.audio.setEnabled(s.sound);
    this.input.setAutoAccel(s.autoAccel);
    // ?calidad=baja|media|alta in the address overrides the saved setting.
    const forced = new URLSearchParams(location.search).get('calidad') as Quality | null;
    if (forced && ['baja', 'media', 'alta'].includes(forced)) s.quality = forced;
    this.setQuality(s.quality === 'auto' ? (this.input.isTouchDevice ? 'media' : 'alta') : s.quality);
  }

  private setQuality(q: Quality) {
    this.quality = q;
    this.view.setQuality(q, this.city);
    this.traffic.setCount(this.view.level.traffic, this.car.x, this.car.z);
    this.peds.setCount(this.view.level.peds, this.car.x, this.car.z);
    this.blob.visible = this.view.level.shadow === 0;
    this.fpsTime = this.fpsFrames = 0;
  }

  private placeAtStart() {
    const r = roads.find((x) => x.name === 'Calle 9')!;
    const p = offsetPoint(r, 470, r.hw * 0.5, { x: 0, z: 0, tx: 0, tz: 0 });
    this.car.place(p.x, p.z, Math.atan2(p.tx, p.tz));
    this.car.frozen = false;
    this.camHeading = this.car.heading;
  }

  private start(mode: Mode) {
    this.mode = mode;
    this.placeAtStart();
    this.mission.start(mode);
    this.traffic.reset(this.car.x, this.car.z);
    this.ui.clearToasts();
    this.ui.show('none');
    this.ui.toast(es.toast.start, 'good');
    this.state = 'playing';
    this.input.enabled = true;
    this.fpsTime = this.fpsFrames = 0;
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.ui.show('pause');
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.show('none');
    this.last = performance.now();
  }

  private toMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.mission.start(this.mode);
    this.car.frozen = false;
    this.ui.show('menu');
  }

  private finish() {
    this.state = 'results';
    this.input.enabled = false;
    this.car.frozen = true;
    this.ui.results({ mode: this.mode, earnings: this.mission.earnings, delivered: this.mission.delivered, bestCombo: this.mission.bestCombo });
  }

  private resetToRoad() {
    if (this.state !== 'playing' || this.resetCooldown > 0 || this.car.frozen) return;
    this.resetCooldown = 1.5;
    const nr = nearestRoad(this.car.x, this.car.z);
    if (nr.road < 0) {
      this.placeAtStart();
      return;
    }
    const r = roads[nr.road];
    const fx = Math.sin(this.car.heading);
    const fz = Math.cos(this.car.heading);
    const p = offsetPoint(r, nr.s, 0, { x: 0, z: 0, tx: 0, tz: 0 });
    const dir = fx * p.tx + fz * p.tz >= 0 ? 1 : -1;
    offsetPoint(r, nr.s, dir * r.hw * 0.4, p);
    this.car.place(p.x, p.z, Math.atan2(p.tx * dir, p.tz * dir));
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = clamp((now - this.last) / 1000, 0.001, 0.05);
    this.last = now;
    this.clock += dt;
    const car = this.car;
    const playing = this.state === 'playing';

    if (this.state !== 'paused') {
      this.input.update();
      if (playing) {
        const n = Math.ceil(dt / PHYS_DT);
        for (let i = 0; i < n; i++) {
          car.step(dt / n, this.input.state, this.city.colliders);
          if (car.landed > 0) {
            this.mission.update(0, car);
            if (car.landed > 0.3) this.audio.play('land');
            car.landed = 0;
          }
        }
      }
      this.traffic.update(dt, car, playing);
      this.peds.update(dt, car);
      this.city.update(dt);
      if (playing) {
        this.crashCooldown -= dt;
        this.resetCooldown -= dt;
        if (car.crash > 4 && this.crashCooldown <= 0) {
          this.audio.play('crash', car.crash);
          this.mission.crash(car.crash);
          this.shake = Math.min(0.5, car.crash * 0.025);
          this.crashCooldown = 0.35;
        }
        car.crash = 0;
        this.mission.update(dt, car);
        if (this.mission.over) this.finish();
      }
      this.updateTaxi(dt);
    }
    this.updateCamera(dt);
    this.audio.drive(car.speed, this.input.state.throttle, playing && car.grounded ? (car.drifting ? 0.25 : this.input.state.handbrake && car.speed > 6 ? 0.15 : 0) : 0, playing);

    if (playing) {
      const m = this.mission;
      this.ui.hud({
        time: m.time,
        earnings: m.earnings,
        speedKmh: car.speed * 3.6,
        combo: m.combo,
        trip: m.trip ? { name: m.trip.dest.name, frac: m.trip.left / m.trip.total } : null,
        carrying: m.state !== 'free',
      });
      this.mapTimer -= dt;
      if (this.mapTimer <= 0) {
        this.mapTimer = 0.06;
        this.minimap.draw(car, m);
      }
      this.watchFps(dt);
    }
    this.view.followSun(car.x, car.y, car.z);
    this.view.render();
  }

  /** On "Auto", step the quality down if the device cannot hold a playable frame rate. */
  private watchFps(dt: number) {
    if (this.ui.settings.quality !== 'auto' || this.quality === 'baja') return;
    this.fpsTime += dt;
    this.fpsFrames++;
    if (this.fpsTime < 4) return;
    const fps = this.fpsFrames / this.fpsTime;
    this.fpsTime = this.fpsFrames = 0;
    if (fps < 40) {
      this.setQuality(this.quality === 'alta' ? 'media' : 'baja');
      this.ui.toast(es.toast.lowQuality);
    }
  }

  private updateTaxi(dt: number) {
    const car = this.car;
    const t = this.taxi;
    t.root.position.set(car.x, car.y + ROAD_Y, car.z);
    t.root.rotation.y = car.heading;
    const targetPitch = car.grounded ? -Math.atan(car.slopeF) : -Math.atan2(car.vy, Math.max(8, car.speed)) * 0.7;
    this.pitch += (targetPitch - this.pitch) * damp(car.grounded ? 12 : 5, dt);
    this.roll += (-Math.atan(car.slopeS) - this.roll) * damp(10, dt);
    t.tilt.rotation.set(this.pitch, 0, this.roll);
    const accel = (car.forward - this.prevForward) / dt;
    this.prevForward = car.forward;
    this.dive += (clamp(-accel * 0.004, -0.05, 0.07) - this.dive) * damp(6, dt);
    t.chassis.rotation.set(this.dive, 0, -clamp(car.steer * car.speed * 0.004 + car.slip * 0.012, -0.12, 0.12));
    const spin = (car.forward * dt) / 0.31;
    t.wheels.forEach((w, i) => {
      w.rotation.x += spin;
      if (i < 2) w.parent!.rotation.y = -car.steer * 0.5;
    });
    t.brake.emissiveIntensity = this.input.state.brake > 0 || this.input.state.handbrake ? 3 : 0;

    this.blob.position.set(car.x, groundHeight(car.x, car.z) + ROAD_Y + 0.05, car.z);
    this.blob.rotation.z = car.heading;

    const target = this.state === 'playing' ? this.mission.target(car) : null;
    this.arrow.visible = !!target && Math.hypot(target.x - car.x, target.z - car.z) > 14;
    if (target) {
      this.arrowMat.color.setHex(target.color);
      this.arrow.position.set(car.x, car.y + 2.9 + Math.sin(this.clock * 4) * 0.12, car.z);
      // The arrow lies flat but is tipped towards the camera so its shape reads from behind.
      this.arrow.rotation.set(-0.75, this.camHeading, 0);
      this.arrowInner.rotation.y = Math.atan2(target.x - car.x, target.z - car.z) - this.camHeading;
    }
  }

  private updateCamera(dt: number) {
    const car = this.car;
    const cam = this.view.camera;
    if (this.state === 'menu') {
      const a = this.clock * 0.12;
      const x = car.x + Math.sin(a) * 12;
      const z = car.z + Math.cos(a) * 12;
      cam.position.set(x, Math.max(car.y + 4.2, groundHeight(x, z) + 2), z);
      cam.fov = 55;
      cam.updateProjectionMatrix();
      cam.lookAt(car.x, car.y + 1.2, car.z);
      this.camPos.copy(cam.position);
      this.camHeading = car.heading;
      return;
    }
    if (this.state === 'paused') return;
    if (car.forward > -2) this.camHeading += angDiff(car.heading, this.camHeading) * damp(4.5, dt);
    const fx = Math.sin(this.camHeading);
    const fz = Math.cos(this.camHeading);
    const speed = car.speed;
    const dist = 7.2 + speed * 0.05;
    const height = 2.9 + speed * 0.012;
    // Pull the camera in if a building would be between it and the taxi.
    let k = 1;
    for (const t of [1, 0.8, 0.6, 0.42]) {
      k = t;
      if (!this.city.colliders.pointInside(car.x - fx * dist * t, car.z - fz * dist * t, 0.8)) break;
    }
    const px = car.x - fx * dist * k;
    const pz = car.z - fz * dist * k;
    const py = Math.max(car.y + height * (0.6 + 0.4 * k), groundHeight(px, pz) + 1.3);
    this.camPos.x = px;
    this.camPos.z = pz;
    this.camPos.y += (py - this.camPos.y) * damp(8, dt);
    this.camPos.y = Math.max(this.camPos.y, groundHeight(px, pz) + 1.1);
    cam.position.copy(this.camPos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-7 * dt);
    }
    const fov = 62 + Math.min(16, speed * 0.4);
    if (Math.abs(fov - cam.fov) > 0.05) {
      cam.fov += (fov - cam.fov) * damp(4, dt);
      cam.updateProjectionMatrix();
    }
    cam.lookAt(car.x + fx * 3, car.y + 1.35, car.z + fz * 3);
  }
}
