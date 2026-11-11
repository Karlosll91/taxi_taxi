# Taxi Taxi

A 3D arcade taxi game set in El Poblado, Medellín. It runs in the browser, the interface is in Spanish, and it plays with keyboard, mouse, or touch.

Pick up passengers at the circles of light, get them to their destination before their patience runs out, and earn tips for near-misses, drifts, and jumps.

## Run it

```bash
npm install
npm run dev      # development server, prints a local address to open
npm test         # unit tests for scoring, roads, collisions, physics, traffic
npm run build    # type-check and build the static site into dist/
npm run preview  # serve the built site locally
```

To try it on a phone on the same network, run `npm run dev -- --host` and open the network address it prints.

## Controls

| Action | Keyboard | Mouse | Touch |
|---|---|---|---|
| Steer | A / D or ← / → | Move the pointer left or right | Drag on the left half of the screen |
| Accelerate | W or ↑ | Left button | Automatic (or the Acelerar button if auto-accelerate is off) |
| Brake / reverse | S or ↓ | Right button | Frenar button (keep holding to reverse) |
| Handbrake / drift | Space | Middle button or Shift | Derrape button |
| Back onto the road | R | On-screen button | On-screen button |
| Pause | Esc or P | On-screen button | On-screen button |
| Horn | H | | |

## Game modes

- **Turno normal**: the clock starts at 70 seconds; every pickup and every fast delivery adds time.
- **Turno fijo**: exactly 3, 5, or 10 minutes, no time bonuses.
- **Paseo libre**: no clock.

High scores and settings are stored in the browser on the device.

## Address options

- `?calidad=baja`, `?calidad=media`, or `?calidad=alta` forces a graphics quality level.
- `?debug` exposes the game object as `window.taxi` in the browser console.

## Deploying

`.github/workflows/deploy.yml` runs the tests and build on every pull request, and publishes `dist/` to GitHub Pages on every push to `main`. For the publish step to work, set **Settings → Pages → Source** to **GitHub Actions** in the repository.

## Code layout

```
src/
  main.ts, game.ts   entry point and the game loop / state machine
  world/             terrain, road network, city generator, textures, collisions
  vehicle/           car physics and the vehicle and person models
  traffic/           traffic cars, buses, pedestrians
  mission/           passengers, clocks, fares, tips (scoring.ts is pure logic)
  input/             keyboard, mouse and touch feeding one input state
  render/            renderer, sky, sun, quality levels
  ui/                menus, HUD, minimap, styles
  audio/             synthesised sound
  i18n/es.ts         every player-facing string
tests/               unit tests
docs/PLAN.md         design plan and implementation status
```

Everything visual is generated in code when the page loads: the map, the building facades, the textures, and the vehicles. The repository contains no image, model, or audio files.

The map is stylised and inspired by El Poblado. Business names in the game are fictional.
