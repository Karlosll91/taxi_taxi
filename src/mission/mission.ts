import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { es } from '../i18n/es';
import { makePerson } from '../traffic/traffic';
import { Car } from '../vehicle/car';
import { Place } from '../world/city';
import { RoadPoint, addressOf, distToJunction, offsetPoint, roads } from '../world/roads';
import { baseHeight } from '../world/terrain';
import { Mode, Rating, TipKind, TripClass, baseFare, classify, delivery, formatCOP, pickupBonus, sessionSeconds, tipValue, tripTime } from './scoring';

export const CLASS_COLOR: Record<TripClass, number> = { corta: 0x4fc3f7, media: 0xffc107, larga: 0xff5fa2 };
export const DEST_COLOR = 0x3dff7a;

const P: RoadPoint = { x: 0, z: 0, tx: 0, tz: 0 };
const PICK_R = 6.5;
const DROP_R = 9;
const WAITING = 7;
const STOP_SPEED = 3.5;
const TINTS = [0xd94f3d, 0x3d7bd9, 0xf2f2f2, 0xe8b93b, 0x4fa36b, 0xc86fb0, 0x6fb7c8, 0xf08a3c];

interface Spot {
  name: string;
  x: number;
  z: number;
  /** Where the person stands on the sidewalk. */
  sx: number;
  sz: number;
}

interface Waiting {
  spot: Spot;
  dest: Spot;
  dist: number;
  cls: TripClass;
  beam: THREE.Mesh;
  person: THREE.Group;
}

export interface MissionUi {
  toast(text: string, kind?: 'good' | 'bad' | 'tip'): void;
  say(text: string): void;
  sound(name: 'cash' | 'pickup' | 'tip' | 'fail'): void;
}

export type MissionState = 'free' | 'boarding' | 'carrying' | 'dropping';

/** Passengers, destinations, clocks and money. */
export class Mission {
  mode: Mode = 'normal';
  time = 0;
  earnings = 0;
  delivered = 0;
  combo = 0;
  bestCombo = 0;
  over = false;
  state: MissionState = 'free';
  waiting: Waiting[] = [];
  trip: { dest: Spot; dist: number; left: number; total: number } | null = null;

  private rng = mulberry32(Date.now() & 0xffff);
  private timer = 0;
  private current: Waiting | null = null;
  private walker: THREE.Group | null = null;
  private walkFrom = new THREE.Vector3();
  private walkTo = new THREE.Vector3();
  private driftTime = 0;
  private sayCooldown = 0;
  private hintCooldown = 0;
  private destBeam: THREE.Mesh;
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  private clock = 0;

  constructor(private scene: THREE.Scene, private places: Place[], private glow: THREE.Texture, private ui: MissionUi) {
    this.beamGeo.translate(0, 0.5, 0);
    this.destBeam = this.makeBeam(DEST_COLOR, DROP_R, 46);
    this.destBeam.visible = false;
  }

  private makeBeam(color: number, radius: number, height: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ color, map: this.glow, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const m = new THREE.Mesh(this.beamGeo, mat);
    m.scale.set(radius, height, radius);
    m.renderOrder = 5;
    this.scene.add(m);
    return m;
  }

  private spotAt(roadId: number, s: number, side: 1 | -1, name?: string): Spot {
    const r = roads[roadId];
    offsetPoint(r, s, side * (r.hw - 2.2), P);
    const x = P.x;
    const z = P.z;
    offsetPoint(r, s, side * (r.hw + 1.3), P);
    return { name: name ?? addressOf(r, s), x, z, sx: P.x, sz: P.z };
  }

  private randomSpot(): Spot | null {
    const r = roads[Math.floor(this.rng() * roads.length)];
    if (r.len < 80) return null;
    const s = 28 + this.rng() * (r.len - 56);
    if (distToJunction(r, s) < 24) return null;
    const sp = this.spotAt(r.id, s, this.rng() < 0.5 ? 1 : -1);
    return Math.abs(sp.x) < 880 && Math.abs(sp.z) < 880 ? sp : null;
  }

  private placeSpot(): Spot {
    const p = this.places[Math.floor(this.rng() * this.places.length)];
    return this.spotAt(p.road, p.s, p.side, p.name);
  }

  private trySpawn(car: Car) {
    const spot = this.rng() < 0.25 ? this.placeSpot() : this.randomSpot();
    if (!spot) return;
    const d = Math.hypot(spot.x - car.x, spot.z - car.z);
    if (d < 60 || d > 650) return;
    if (this.waiting.some((w) => Math.hypot(w.spot.x - spot.x, w.spot.z - spot.z) < 70)) return;
    const dest = this.rng() < 0.5 ? this.placeSpot() : this.randomSpot();
    if (!dest) return;
    const dist = Math.abs(dest.x - spot.x) + Math.abs(dest.z - spot.z);
    if (dist < 260) return;
    const cls = classify(dist);
    const beam = this.makeBeam(CLASS_COLOR[cls], PICK_R, 18);
    beam.position.set(spot.x, baseHeight(spot.x, spot.z) - 0.6, spot.z);
    const person = makePerson(TINTS[Math.floor(this.rng() * TINTS.length)]);
    person.position.set(spot.sx, baseHeight(spot.sx, spot.sz) + 0.2, spot.sz);
    person.rotation.y = Math.atan2(spot.x - spot.sx, spot.z - spot.sz);
    this.scene.add(person);
    this.waiting.push({ spot, dest, dist, cls, beam, person });
  }

  private dispose(w: Waiting) {
    this.scene.remove(w.beam, w.person);
    (w.beam.material as THREE.Material).dispose();
  }

  start(mode: Mode) {
    for (const w of this.waiting) this.dispose(w);
    if (this.walker) this.scene.remove(this.walker);
    this.walker = null;
    this.waiting = [];
    this.mode = mode;
    this.time = sessionSeconds(mode);
    this.earnings = this.delivered = this.combo = this.bestCombo = 0;
    this.over = false;
    this.state = 'free';
    this.trip = null;
    this.current = null;
    this.destBeam.visible = false;
    this.driftTime = 0;
  }

  private speak(lines: readonly string[], force = false) {
    if (!force && this.sayCooldown > 0) return;
    this.sayCooldown = 3;
    this.ui.say(lines[Math.floor(this.rng() * lines.length)]);
  }

  private tip(kind: TipKind) {
    if (this.state !== 'carrying') return;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const amount = tipValue(kind, this.combo);
    this.earnings += amount;
    this.ui.toast(`${es.toast[kind]} +$${amount}${this.combo > 1 ? `  x${this.combo}` : ''}`, 'tip');
    this.ui.sound('tip');
    if (kind === 'near') this.speak(es.say.near);
    if (kind === 'jump') this.speak(es.say.jump);
  }

  nearMiss() {
    this.tip('near');
  }

  crash(impact: number) {
    if (impact < 6) return;
    if (this.combo > 1) this.ui.toast(es.toast.crash, 'bad');
    this.combo = 0;
    if (this.state === 'carrying') this.speak(es.say.crash);
  }

  /** What the guidance arrow should point at. */
  target(car: Car): { x: number; z: number; color: number } | null {
    if (this.trip) return { x: this.trip.dest.x, z: this.trip.dest.z, color: DEST_COLOR };
    if (this.state !== 'free') return null;
    let best: Waiting | null = null;
    let bd = Infinity;
    for (const w of this.waiting) {
      const d = Math.hypot(w.spot.x - car.x, w.spot.z - car.z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best ? { x: best.spot.x, z: best.spot.z, color: CLASS_COLOR[best.cls] } : null;
  }

  update(dt: number, car: Car) {
    if (this.over) return;
    this.clock += dt;
    this.sayCooldown -= dt;
    this.hintCooldown -= dt;
    if (this.waiting.length < WAITING) this.trySpawn(car);
    const pulse = 1 + 0.06 * Math.sin(this.clock * 5);
    for (const w of this.waiting) {
      w.beam.scale.x = w.beam.scale.z = PICK_R * pulse;
      w.person.position.y = baseHeight(w.spot.sx, w.spot.sz) + 0.2 + Math.abs(Math.sin(this.clock * 4 + w.spot.x)) * 0.12;
    }
    this.destBeam.scale.x = this.destBeam.scale.z = DROP_R * pulse;

    const moving = this.state === 'free' || this.state === 'carrying';
    if (moving && this.time !== Infinity) {
      this.time -= dt;
      if (this.time <= 0) {
        this.time = 0;
        this.over = true;
        return;
      }
    }

    if (car.landed > 0.55) this.tip('jump');
    if (car.drifting) {
      this.driftTime += dt;
      if (this.driftTime > 0.9) {
        this.driftTime = 0;
        this.tip('drift');
      }
    } else this.driftTime = 0;

    if (this.state === 'free') {
      for (let i = 0; i < this.waiting.length; i++) {
        const w = this.waiting[i];
        if (Math.hypot(w.spot.x - car.x, w.spot.z - car.z) > PICK_R || !car.grounded) continue;
        if (car.speed > STOP_SPEED) {
          if (this.hintCooldown <= 0) {
            this.ui.toast(es.toast.hintStop);
            this.hintCooldown = 4;
          }
          continue;
        }
        this.waiting.splice(i, 1);
        this.current = w;
        this.state = 'boarding';
        this.timer = 0.9;
        car.frozen = true;
        this.scene.remove(w.beam);
        this.walker = w.person;
        this.walkFrom.copy(w.person.position);
        this.walkTo.set(car.x, car.y + 0.1, car.z);
        break;
      }
    } else if (this.state === 'boarding' || this.state === 'dropping') {
      this.timer -= dt;
      const t = 1 - Math.max(0, this.timer) / 0.9;
      if (this.walker) {
        this.walker.position.lerpVectors(this.walkFrom, this.walkTo, t);
        this.walker.position.y += Math.sin(t * Math.PI * 4) * 0.05;
        this.walker.rotation.y = Math.atan2(this.walkTo.x - this.walkFrom.x, this.walkTo.z - this.walkFrom.z);
      }
      if (this.timer <= 0) {
        car.frozen = false;
        if (this.state === 'boarding' && this.current) {
          const w = this.current;
          w.person.visible = false;
          const total = tripTime(w.dist);
          this.trip = { dest: w.dest, dist: w.dist, left: total, total };
          this.destBeam.position.set(w.dest.x, baseHeight(w.dest.x, w.dest.z) - 0.6, w.dest.z);
          this.destBeam.visible = true;
          this.state = 'carrying';
          if (this.mode === 'normal') {
            const b = pickupBonus(w.dist);
            this.time += b;
            this.ui.toast(es.toast.pickup(b), 'good');
          } else this.ui.toast(es.toast.pickupFree, 'good');
          this.ui.sound('pickup');
          const line = es.say.pickup[Math.floor(this.rng() * es.say.pickup.length)];
          this.sayCooldown = 3.5;
          this.ui.say(line(w.dest.name));
        } else {
          if (this.walker) this.scene.remove(this.walker);
          this.walker = null;
          this.current = null;
          this.state = 'free';
        }
      }
    } else if (this.state === 'carrying' && this.trip) {
      const tr = this.trip;
      tr.left -= dt;
      if (tr.left <= 0) {
        this.ui.toast(es.toast.lost, 'bad');
        this.ui.sound('fail');
        this.speak(es.say.timeout, true);
        this.endTrip();
        if (this.current) this.scene.remove(this.current.person);
        this.current = null;
        this.combo = 0;
        return;
      }
      if (Math.hypot(tr.dest.x - car.x, tr.dest.z - car.z) < DROP_R && car.grounded) {
        if (car.speed > STOP_SPEED) {
          if (this.hintCooldown <= 0) {
            this.ui.toast(es.toast.hintStop);
            this.hintCooldown = 4;
          }
          return;
        }
        const res = delivery(tr.left / tr.total);
        const pay = Math.round((baseFare(tr.dist) * res.mult) / 100) * 100;
        this.earnings += pay;
        this.delivered++;
        if (this.mode === 'normal') this.time += res.bonus;
        this.ui.toast(`${es.toast.rating[res.rating]}  +${formatCOP(pay)}${this.mode === 'normal' ? `  ·  ${es.toast.bonus(res.bonus)}` : ''}`, res.rating === 'lento' ? undefined : 'good');
        this.ui.sound('cash');
        this.speak(es.say[res.rating as Rating], true);
        const dest = tr.dest;
        this.endTrip();
        this.state = 'dropping';
        this.timer = 0.9;
        car.frozen = true;
        if (this.current) {
          this.walker = this.current.person;
          this.walker.visible = true;
          this.walkFrom.set(car.x, car.y + 0.1, car.z);
          this.walkTo.set(dest.sx, baseHeight(dest.sx, dest.sz) + 0.2, dest.sz);
        }
      }
    }
  }

  private endTrip() {
    this.trip = null;
    this.destBeam.visible = false;
    this.state = 'free';
  }
}
