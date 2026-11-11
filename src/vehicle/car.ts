import { angDiff, clamp, damp, lerp } from '../core/math';
import { Colliders, Hit } from '../world/collide';
import { SIDEWALK, nearestRoad, roads } from '../world/roads';
import { BOUND, baseHeight, groundHeight } from '../world/terrain';

export interface CarInput {
  /** -1 (left) to 1 (right). */
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
}

const GRAVITY = 18;
const WHEELBASE = 2.6;
const hit: Hit = { nx: 0, nz: 0, depth: 0 };

/**
 * Arcade car model: one rigid body with forward speed, heading and sideways slip.
 * Heading 0 faces +z; turning right decreases the heading.
 */
export class Car {
  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  grounded = true;
  steer = 0;
  /** Signed forward speed and sideways slip, m/s. */
  forward = 0;
  slip = 0;
  drifting = false;
  onRoad = true;
  frozen = false;
  /** Seconds in the air during the current jump. */
  airTime = 0;
  /** Set for one step when the car lands; holds the length of the jump in seconds. */
  landed = 0;
  /** Strongest impact speed since the game last cleared it. */
  crash = 0;
  /** Gradient under the car along its heading, for the visual pitch. */
  slopeF = 0;
  slopeS = 0;

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  place(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = this.vy = 0;
    this.y = groundHeight(x, z);
    this.grounded = true;
    this.airTime = 0;
    this.steer = 0;
  }

  step(dt: number, input: CarInput, colliders: Colliders) {
    this.landed = 0;
    if (this.frozen) {
      this.vx = this.vz = this.vy = 0;
      this.forward = this.slip = 0;
      this.drifting = false;
      this.y = groundHeight(this.x, this.z);
      return;
    }
    let fx = Math.sin(this.heading);
    let fz = Math.cos(this.heading);
    let vF = this.vx * fx + this.vz * fz;
    this.steer += (input.steer - this.steer) * damp(9, dt);

    this.slopeF = (baseHeight(this.x + fx * 1.5, this.z + fz * 1.5) - baseHeight(this.x - fx * 1.5, this.z - fz * 1.5)) / 3;
    this.slopeS = (baseHeight(this.x - fz * 0.9, this.z + fx * 0.9) - baseHeight(this.x + fz * 0.9, this.z - fx * 0.9)) / 1.8;

    if (this.grounded) {
      const nr = nearestRoad(this.x, this.z);
      this.onRoad = nr.road >= 0 && nr.dist < roads[nr.road].hw + SIDEWALK;
      const vmax = this.onRoad ? 41 : 23;
      let a = 0;
      if (input.throttle > 0) a += vF < -0.5 ? 24 * input.throttle : 12.5 * input.throttle * Math.max(0, 1 - (vF / vmax) ** 2);
      if (input.brake > 0) a -= vF > 0.8 ? 26 * input.brake : 7 * input.brake * Math.max(0, 1 - (vF / 11) ** 2);
      if (input.handbrake && Math.abs(vF) > 0.5) a -= Math.sign(vF) * 6;
      a -= vF * (this.onRoad ? 0.07 : 0.55);
      if (Math.abs(vF) > 0.2) a -= Math.sign(vF) * 0.5;
      a -= 9.8 * this.slopeF * 0.8;
      if (input.throttle === 0 && input.brake === 0 && Math.abs(vF) < 0.6) {
        // Parked: hold still instead of creeping down the hill.
        this.vx -= fx * vF;
        this.vz -= fz * vF;
      } else {
        this.vx += fx * a * dt;
        this.vz += fz * a * dt;
      }
      vF = this.vx * fx + this.vz * fz;

      const maxSteer = lerp(0.55, 0.1, clamp(Math.abs(vF) / 38, 0, 1));
      let yaw = (vF / WHEELBASE) * Math.tan(this.steer * maxSteer);
      const lim = (input.handbrake ? 30 : 21) / Math.max(Math.abs(vF), 5);
      yaw = clamp(yaw, -lim, lim);
      if (input.handbrake) yaw *= 1.35;
      this.heading -= yaw * dt;

      fx = Math.sin(this.heading);
      fz = Math.cos(this.heading);
      const rx = -fz;
      const rz = fx;
      vF = this.vx * fx + this.vz * fz;
      const vS = this.vx * rx + this.vz * rz;
      const grip = input.handbrake ? 1.7 : Math.abs(vS) > 7 ? 4.5 : 9;
      const vS2 = vS * Math.exp(-grip * dt);
      if (Math.abs(vF) > 3) vF = Math.sign(vF) * Math.sqrt(vF * vF + (vS * vS - vS2 * vS2) * 0.85);
      this.vx = fx * vF + rx * vS2;
      this.vz = fz * vF + rz * vS2;
      this.forward = vF;
      this.slip = vS2;
      this.drifting = Math.abs(vS2) > 3.5 && this.speed > 10;
    } else {
      this.heading -= this.steer * 0.5 * dt;
      this.drifting = false;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Static obstacles: two circles, front and rear.
    for (const off of [1.15, -1.15]) {
      const cx = this.x + fx * off;
      const cz = this.z + fz * off;
      if (!colliders.resolveCircle(cx, cz, 1.0, hit)) continue;
      this.x += hit.nx * hit.depth;
      this.z += hit.nz * hit.depth;
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        this.vx -= 1.25 * vn * hit.nx;
        this.vz -= 1.25 * vn * hit.nz;
        this.vx *= 0.94;
        this.vz *= 0.94;
        this.crash = Math.max(this.crash, -vn);
        const fn = fx * hit.nx + fz * hit.nz;
        if (off > 0 && fn < 0) {
          // Swing the nose along the wall so the car does not stick to it.
          const tx = fx - fn * hit.nx;
          const tz = fz - fn * hit.nz;
          const along = Math.hypot(tx, tz) > 0.15 ? Math.atan2(tx, tz) : this.heading + (this.steer > 0 ? -1.2 : 1.2);
          // A hard hit turns the nose at once; holding the throttle against a wall keeps turning it.
          this.heading += angDiff(along, this.heading) * Math.min(1, -vn * 0.07 + (input.throttle > 0 ? 2.5 * dt : 0));
        }
      }
    }
    if (Math.abs(this.x) > BOUND) {
      this.x = Math.sign(this.x) * BOUND;
      this.vx = 0;
    }
    if (Math.abs(this.z) > BOUND) {
      this.z = Math.sign(this.z) * BOUND;
      this.vz = 0;
    }

    const ground = groundHeight(this.x, this.z);
    if (this.grounded) {
      const newVy = (ground - this.y) / dt;
      if (newVy < this.vy - GRAVITY * dt - 1.5) {
        this.grounded = false;
        this.airTime = 0;
        this.vy = Math.min(this.vy, 14);
        this.y += this.vy * dt;
      } else {
        this.vy = clamp(newVy, -30, Math.max(4, this.speed * 0.6));
        this.y = ground;
      }
    } else {
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.grounded = true;
        this.landed = this.airTime;
        this.vy = 0;
      }
    }
  }
}
