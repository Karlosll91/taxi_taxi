import { es } from '../i18n/es';
import { Mode, formatClock, formatCOP, rank } from '../mission/scoring';

export type Quality = 'baja' | 'media' | 'alta';
export interface Settings {
  quality: Quality | 'auto';
  sound: boolean;
  autoAccel: boolean;
}

const SETTINGS_KEY = 'taxitaxi.ajustes';
const RECORDS_KEY = 'taxitaxi.records';

function load<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: scores simply are not kept */
  }
}

export interface HudData {
  time: number;
  earnings: number;
  speedKmh: number;
  combo: number;
  trip: { name: string; frac: number } | null;
  carrying: boolean;
}

export interface ResultData {
  mode: Mode;
  earnings: number;
  delivered: number;
  bestCombo: number;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Menus, HUD and touch controls, all plain HTML over the canvas. */
export class Ui {
  settings: Settings = load<Settings>(SETTINGS_KEY, { quality: 'auto', sound: true, autoAccel: true });
  records: Record<string, number> = load<Record<string, number>>(RECORDS_KEY, {});
  onStart = (_mode: Mode) => {};
  onResume = () => {};
  onRestart = () => {};
  onQuit = () => {};
  onPause = () => {};
  onReset = () => {};
  onSettings = () => {};
  onGesture = () => {};
  touchRoot: HTMLElement;
  minimap: HTMLCanvasElement;

  private sayTimer = 0;
  private last = { clock: '', money: '', speed: '', combo: '', name: '' };

  constructor() {
    const m = es.menu;
    const s = es.settings;
    const seg = (id: string, opts: [string, string][]) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
    $('#ui').innerHTML = `
      <div id="hud" hidden>
        <div id="clock" class="pill"><span class="lab">${es.hud.time}</span><span class="val">0:00</span></div>
        <canvas id="minimap" width="336" height="336"></canvas>
        <div id="trip" class="pill idle"><span class="lab">${es.hud.to}</span><div class="name">${es.hud.find}</div><div class="bar"><i></i></div></div>
        <div id="topright">
          <div id="money" class="pill"><span class="lab">${es.hud.earnings}</span><span class="val">$ 0</span><div id="combo"></div></div>
          <button class="icon" id="hud-reset" title="${es.hud.reset}">↺</button>
          <button class="icon" id="hud-pause" title="${es.pause.title}">❚❚</button>
        </div>
        <div id="toasts"></div>
        <div id="say"></div>
        <div id="speed" class="pill"><span class="val">0</span><span class="lab">${es.hud.kmh}</span></div>
      </div>
      <div id="touch">
        <div id="steer-zone"><div id="steer-track"><div id="steer-knob"></div></div></div>
        <div class="tbtn" id="btn-drift">${es.hud.drift}</div>
        <div class="tbtn" id="btn-gas">${es.hud.gas}</div>
        <div class="tbtn" id="btn-brake">${es.hud.brake}</div>
      </div>
      <div class="screen" id="menu" hidden><div class="panel">
        <h1>${es.title}</h1><div class="sub">${es.subtitle}</div>
        <div class="modes">
          <button class="btn" data-mode="normal">${m.normal}<small>${m.normalHint}</small></button>
          <div class="fixed-row"><div class="label">${m.fixed}<small>${m.fixedHint}</small></div>
            ${[3, 5, 10].map((n) => `<button class="btn" data-mode="fijo${n}">${m.minutes(n)}</button>`).join('')}</div>
          <button class="btn" data-mode="libre">${m.free}<small>${m.freeHint}</small></button>
          <div class="row"><button class="btn ghost" data-open="settings">${m.settings}</button><button class="btn ghost" data-open="help">${m.help}</button><button class="btn ghost" data-open="records">${m.records}</button></div>
        </div>
        <div class="foot">${m.credits}</div>
      </div></div>
      <div class="screen" id="settings" hidden><div class="panel">
        <h2>${m.settings}</h2>
        <div class="setting"><span>${s.quality}</span>${seg('set-quality', Object.entries(s.qualities))}</div>
        <div class="setting"><span>${s.sound}</span>${seg('set-sound', [['1', s.on], ['0', s.off]])}</div>
        <div class="setting"><span>${s.autoAccel}</span>${seg('set-auto', [['1', s.on], ['0', s.off]])}</div>
        <button class="btn ghost mt" data-close>${m.back}</button>
      </div></div>
      <div class="screen" id="help" hidden><div class="panel wide">
        <h2>${m.help}</h2><p>${es.help.goal}</p>
        <table><tr>${es.help.head.map((h) => `<th>${h}</th>`).join('')}</tr>
          ${es.help.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>
        <p>${es.help.colors}</p>
        <button class="btn ghost mt" data-close>${m.back}</button>
      </div></div>
      <div class="screen" id="records" hidden><div class="panel">
        <h2>${m.records}</h2><div id="records-list"></div>
        <button class="btn ghost mt" data-close>${m.back}</button>
      </div></div>
      <div class="screen" id="pause" hidden><div class="panel">
        <h2>${es.pause.title}</h2>
        <div class="modes">
          <button class="btn" id="p-resume">${es.pause.resume}</button>
          <button class="btn ghost" id="p-restart">${es.pause.restart}</button>
          <button class="btn ghost" data-open="settings">${m.settings}</button>
          <button class="btn ghost" id="p-quit">${es.pause.quit}</button>
        </div>
      </div></div>
      <div class="screen" id="results" hidden><div class="panel">
        <h2>${es.results.title}</h2>
        <div class="rank" id="r-rank"></div><div class="record" id="r-record"></div>
        <div class="stat"><span>${es.results.earnings}</span><b id="r-earn"></b></div>
        <div class="stat"><span>${es.results.passengers}</span><b id="r-pass"></b></div>
        <div class="stat"><span>${es.results.combo}</span><b id="r-combo"></b></div>
        <div class="stat"><span>${es.results.best}</span><b id="r-best"></b></div>
        <div class="row mt"><button class="btn" id="r-again">${es.results.again}</button><button class="btn ghost" id="r-menu">${es.results.menu}</button></div>
      </div></div>
      <div class="screen" id="rotate">${es.rotate}</div>`;

    this.touchRoot = $('#touch');
    this.minimap = $<HTMLCanvasElement>('#minimap');

    let returnTo = 'menu';
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.onGesture();
        this.onStart(b.dataset.mode as Mode);
      }),
    );
    document.querySelectorAll<HTMLElement>('[data-open]').forEach((b) =>
      b.addEventListener('click', () => {
        returnTo = b.closest('.screen')!.id;
        if (b.dataset.open === 'records') this.fillRecords();
        this.show(b.dataset.open!);
      }),
    );
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.show(returnTo)));
    $('#p-resume').addEventListener('click', () => this.onResume());
    $('#p-restart').addEventListener('click', () => this.onRestart());
    $('#p-quit').addEventListener('click', () => this.onQuit());
    $('#r-again').addEventListener('click', () => this.onRestart());
    $('#r-menu').addEventListener('click', () => this.onQuit());
    $('#hud-pause').addEventListener('click', () => this.onPause());
    $('#hud-reset').addEventListener('click', () => this.onReset());

    const bind = (id: string, get: () => string, set: (v: string) => void) => {
      const root = $(id);
      const refresh = () => root.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === get()));
      root.querySelectorAll<HTMLElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          set(b.dataset.v!);
          save(SETTINGS_KEY, this.settings);
          refresh();
          this.onSettings();
        }),
      );
      refresh();
    };
    bind('#set-quality', () => this.settings.quality, (v) => (this.settings.quality = v as Settings['quality']));
    bind('#set-sound', () => (this.settings.sound ? '1' : '0'), (v) => (this.settings.sound = v === '1'));
    bind('#set-auto', () => (this.settings.autoAccel ? '1' : '0'), (v) => (this.settings.autoAccel = v === '1'));
  }

  private fillRecords() {
    const rows = Object.entries(es.records.modes)
      .filter(([k]) => this.records[k])
      .map(([k, label]) => `<div class="stat"><span>${label}</span><b>${formatCOP(this.records[k])} · ${rank(this.records[k])}</b></div>`);
    $('#records-list').innerHTML = rows.length ? rows.join('') : `<p>${es.records.none}</p>`;
  }

  /** Shows one full-screen panel (or none) and toggles the HUD. */
  show(id: 'menu' | 'pause' | 'results' | 'none' | string) {
    for (const s of ['menu', 'settings', 'help', 'records', 'pause', 'results']) $('#' + s).hidden = s !== id;
    const playing = id === 'none';
    $('#hud').hidden = !(playing || id === 'pause');
    document.body.classList.toggle('playing', playing);
  }

  hideLoading() {
    $('#loading').hidden = true;
  }

  clearToasts() {
    $('#toasts').innerHTML = '';
    $('#say').classList.remove('show');
  }

  toast(text: string, kind = '') {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => el.remove(), 2200);
  }

  say(text: string) {
    const el = $('#say');
    el.textContent = '“' + text + '”';
    el.classList.add('show');
    clearTimeout(this.sayTimer);
    this.sayTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
  }

  hud(d: HudData) {
    const L = this.last;
    const clock = d.time === Infinity ? '∞' : formatClock(d.time);
    if (clock !== L.clock) {
      $('#clock .val').textContent = L.clock = clock;
      $('#clock').classList.toggle('low', d.time < 10);
    }
    const money = formatCOP(d.earnings);
    if (money !== L.money) $('#money .val').textContent = L.money = money;
    const speed = String(Math.round(d.speedKmh));
    if (speed !== L.speed) $('#speed .val').textContent = L.speed = speed;
    const combo = d.combo > 1 ? es.hud.combo(d.combo) : '';
    if (combo !== L.combo) $('#combo').textContent = L.combo = combo;
    const name = d.trip ? d.trip.name : d.carrying ? es.hud.boarding : es.hud.find;
    if (name !== L.name) {
      $('#trip .name').textContent = L.name = name;
      $('#trip').classList.toggle('idle', !d.trip);
    }
    if (d.trip) {
      const bar = $('#trip .bar i');
      bar.style.transform = `scaleX(${Math.max(0, d.trip.frac).toFixed(3)})`;
      bar.style.background = d.trip.frac > 0.45 ? '#3dff7a' : d.trip.frac > 0.15 ? '#ffc107' : '#ff5a4f';
    }
  }

  results(r: ResultData) {
    const prev = this.records[r.mode] ?? 0;
    const isRecord = r.mode !== 'libre' && r.earnings > prev;
    if (isRecord) {
      this.records[r.mode] = r.earnings;
      save(RECORDS_KEY, this.records);
    }
    $('#r-rank').textContent = `${es.results.rank}: ${rank(r.earnings)}`;
    $('#r-record').textContent = isRecord && r.earnings > 0 ? es.results.record : '';
    $('#r-earn').textContent = formatCOP(r.earnings);
    $('#r-pass').textContent = String(r.delivered);
    $('#r-combo').textContent = 'x' + r.bestCombo;
    $('#r-best').textContent = r.mode === 'libre' ? '—' : formatCOP(Math.max(prev, r.earnings));
    this.show('results');
  }
}
