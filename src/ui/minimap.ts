import { CLASS_COLOR, DEST_COLOR, Mission } from '../mission/mission';
import { Car } from '../vehicle/car';
import { PARKS } from '../world/city';
import { roads } from '../world/roads';

const WORLD = 1000;
const BASE = 1024;
const k = BASE / (WORLD * 2);
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Heading-up minimap: the street plan is drawn once, then blitted rotated each frame. */
export class Minimap {
  private base = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private size: number;
  /** Metres from the taxi to the edge of the map view. */
  private range = 260;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.size = canvas.width;
    this.base.width = this.base.height = BASE;
    const b = this.base.getContext('2d')!;
    b.fillStyle = '#26303a';
    b.fillRect(0, 0, BASE, BASE);
    b.fillStyle = '#3f5d6b';
    b.fillRect((-1000 + WORLD) * k, 0, 70 * k, BASE);
    b.fillStyle = '#3d6a45';
    for (const p of PARKS) b.fillRect((p.x0 + WORLD) * k, (p.z0 + WORLD) * k, (p.x1 - p.x0) * k, (p.z1 - p.z0) * k);
    b.lineCap = 'round';
    b.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const r of roads) {
        b.strokeStyle = pass ? (r.lanes === 4 ? '#f1f3f5' : '#aeb7bf') : '#11151c';
        b.lineWidth = Math.max(2.2, r.hw * 2 * k) + (pass ? 0 : 2);
        b.beginPath();
        for (let i = 0; i < r.n; i++) b.lineTo((r.px[i] + WORLD) * k, (r.pz[i] + WORLD) * k);
        b.stroke();
      }
    }
  }

  draw(car: Car, mission: Mission) {
    const c = this.ctx;
    const S = this.size;
    const scale = S / (this.range * 2);
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.roundRect(0, 0, S, S, 26);
    c.clip();
    c.fillStyle = '#26303a';
    c.fillRect(0, 0, S, S);
    c.translate(S / 2, S * 0.62);
    // Heading-up: rotate the world so the taxi's forward direction points to the top.
    c.rotate(car.heading + Math.PI);
    c.scale(scale, scale);
    c.translate(-car.x, -car.z);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, -WORLD, -WORLD, WORLD * 2, WORLD * 2);

    const dot = (x: number, z: number, color: string, r: number) => {
      // Keep far markers on the rim so the player always sees which way to go.
      let dx = x - car.x;
      let dz = z - car.z;
      const d = Math.hypot(dx, dz);
      const max = this.range * 0.7;
      if (d > max) {
        dx *= max / d;
        dz *= max / d;
      }
      c.fillStyle = color;
      c.strokeStyle = '#11151c';
      c.lineWidth = 2 / scale;
      c.beginPath();
      c.arc(car.x + dx, car.z + dz, r / scale, 0, 7);
      c.fill();
      c.stroke();
    };
    if (mission.trip) dot(mission.trip.dest.x, mission.trip.dest.z, hex(DEST_COLOR), 11);
    else for (const w of mission.waiting) dot(w.spot.x, w.spot.z, hex(CLASS_COLOR[w.cls]), 7);
    c.restore();

    c.fillStyle = '#ffc400';
    c.strokeStyle = '#11151c';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(S / 2, S * 0.62 - 16);
    c.lineTo(S / 2 + 11, S * 0.62 + 12);
    c.lineTo(S / 2, S * 0.62 + 6);
    c.lineTo(S / 2 - 11, S * 0.62 + 12);
    c.closePath();
    c.fill();
    c.stroke();
  }
}
