import { clamp } from '../core/math';
import { CarInput } from '../vehicle/car';

export type InputMode = 'keyboard' | 'mouse' | 'touch';

const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/**
 * Keyboard, mouse and touch all write to one CarInput. The active method is
 * whichever the player used last, so they can be mixed freely.
 */
export class Input {
  state: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  mode: InputMode;
  autoAccel = true;
  enabled = false;
  onPause = () => {};
  onReset = () => {};
  onHorn = () => {};
  readonly isTouchDevice = matchMedia('(pointer: coarse)').matches;

  private keys = new Set<string>();
  private mouseX = 0;
  private mouseButtons = 0;
  private touchSteer = 0;
  private steerPointer = -1;
  private steerStart = 0;
  private stopTimer = 0;
  private held = { gas: false, brake: false, drift: false };

  constructor(canvas: HTMLCanvasElement, private touchRoot: HTMLElement) {
    this.mode = this.isTouchDevice ? 'touch' : 'keyboard';
    document.body.classList.toggle('touch', this.isTouchDevice);

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (DRIVE_KEYS.has(e.code)) {
        this.setMode('keyboard');
        if (this.enabled) e.preventDefault();
      }
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
      if (e.code === 'KeyR') this.onReset();
      if (e.code === 'KeyH') this.onHorn();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.setMode('mouse');
      this.mouseButtons = e.buttons;
      this.mouseX = e.clientX;
      e.preventDefault();
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseX = e.clientX;
      this.mouseButtons = e.buttons;
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') this.mouseButtons = e.buttons;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    // Touch: drag anywhere on the left half to steer, buttons on the right.
    const zone = touchRoot.querySelector<HTMLElement>('#steer-zone')!;
    const knob = touchRoot.querySelector<HTMLElement>('#steer-knob')!;
    const setKnob = () => (knob.style.transform = `translateX(${this.touchSteer * 52}px)`);
    zone.addEventListener('pointerdown', (e) => {
      this.setMode('touch');
      if (this.steerPointer !== -1) return;
      this.steerPointer = e.pointerId;
      this.steerStart = e.clientX;
      zone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer) return;
      this.touchSteer = clamp((e.clientX - this.steerStart) / 64, -1, 1);
      setKnob();
    });
    const endSteer = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = -1;
      this.touchSteer = 0;
      setKnob();
    };
    zone.addEventListener('pointerup', endSteer);
    zone.addEventListener('pointercancel', endSteer);

    const hold = (id: string, key: keyof Input['held']) => {
      const el = touchRoot.querySelector<HTMLElement>(id)!;
      const set = (v: boolean) => (e: PointerEvent) => {
        this.setMode('touch');
        this.held[key] = v;
        el.classList.toggle('down', v);
        if (v) el.setPointerCapture(e.pointerId);
        e.preventDefault();
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
    };
    hold('#btn-gas', 'gas');
    hold('#btn-brake', 'brake');
    hold('#btn-drift', 'drift');
    for (const ev of ['touchstart', 'touchmove', 'gesturestart']) touchRoot.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }

  private setMode(m: InputMode) {
    if (this.mode === m) return;
    this.mode = m;
    document.body.classList.toggle('touch', m === 'touch');
  }

  setAutoAccel(v: boolean) {
    this.autoAccel = v;
    this.touchRoot.classList.toggle('auto', v);
  }

  /** `forward` is the taxi's forward speed, used so a held touch brake stops before it reverses. */
  update(dt: number, forward: number) {
    const s = this.state;
    const k = this.keys;
    if (this.mode === 'keyboard') {
      s.steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      s.throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
      s.brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
      s.handbrake = k.has('Space');
    } else if (this.mode === 'mouse') {
      const v = (this.mouseX - innerWidth / 2) / (innerWidth * 0.28);
      s.steer = Math.abs(v) < 0.04 ? 0 : clamp(v, -1, 1);
      s.throttle = this.mouseButtons & 1 ? 1 : 0;
      s.brake = this.mouseButtons & 2 ? 1 : 0;
      s.handbrake = (this.mouseButtons & 4) !== 0 || k.has('ShiftLeft') || k.has('ShiftRight');
    } else {
      s.steer = Math.sign(this.touchSteer) * Math.pow(Math.abs(this.touchSteer), 1.3);
      // Holding the brake stops the taxi and keeps it still for a moment; keep holding to reverse.
      if (!this.held.brake || forward > 1) this.stopTimer = 0;
      else this.stopTimer += dt;
      s.brake = this.held.brake && (forward > 1 || this.stopTimer > 0.6) ? 1 : 0;
      s.throttle = this.held.brake ? 0 : this.autoAccel || this.held.gas ? 1 : 0;
      s.handbrake = this.held.drift;
    }
    if (!this.enabled) {
      s.steer = s.throttle = s.brake = 0;
      s.handbrake = false;
    }
  }
}
