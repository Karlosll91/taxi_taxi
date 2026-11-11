# Taxi Taxi — Development Plan

An original 3D arcade taxi game set in El Poblado, Medellín. Runs in the browser, all player-facing text in Spanish, playable with keyboard, mouse, and touch.

The game borrows the *genre* of arcade taxi games (pick up a passenger, race the clock, get paid for speed and style). Name, characters, art, music, map, and UI are original.

## 1. Game design

### Core loop

1. The player drives a yellow Medellín taxi freely around El Poblado.
2. Waiting passengers stand on the sidewalk inside a coloured ring. The ring colour shows trip length (short / medium / long).
3. Stopping inside the ring picks the passenger up. A destination is announced and a 3D arrow above the taxi points toward it.
4. A per-trip countdown starts. Reaching the destination zone and stopping pays the fare.
5. A global session clock runs throughout. Each pickup and each fast delivery adds seconds. When it reaches zero, the shift ends and the player gets a final score and rank.

### Scoring

| Source | Effect |
|---|---|
| Base fare | Proportional to route distance, shown in Colombian pesos (COP) |
| Speed bonus | Extra fare and extra session seconds for arriving early |
| Propinas (tips) | Small cash for near-misses with traffic, drifts, and jumps while carrying a passenger |
| Combo | Consecutive tips without a crash multiply the tip value |
| Crash | Breaks the combo; passenger patience drops |
| Timeout | Passenger leaves, no fare |

End-of-shift ranks use local flavour: *Novato → Taxista → Berraco → Leyenda del Poblado*.

### Modes

- **Turno normal**: session clock, extended by good driving. The main mode.
- **Turno fijo**: fixed 3, 5, or 10 minutes, for score chasing.
- **Paseo libre**: no clock, for exploring the map. Cheap to add and useful for testing.

### Local flavour

- Vehicles: small yellow hatchback taxi, buses, motorbikes, delivery riders, a chiva as a rare traffic vehicle.
- Passengers speak in short paisa lines shown as speech bubbles ("¡Hágale pues!", "¡Uy, despacio, mijo!").
- Fares in COP, distances in metres, street names as *Calle* / *Carrera*.

## 2. The map: El Poblado

### Scope

A playable area of roughly 2 × 2 km, stylised rather than street-accurate. The real district is recognisable through its layout, its slope, and a set of landmarks.

Landmarks used as pickup and drop-off points:

- Parque Lleras and the Provenza restaurant streets
- Parque de El Poblado and its church
- Avenida El Poblado (Carrera 43A) and the Milla de Oro towers
- Calle 10, the main east–west climb
- Estación Poblado (Metro) and the Avenida Las Vegas / river edge
- Shopping centres along the avenue and up the hill
- Las Lomas: steep, winding residential streets toward Las Palmas

Real businesses appear as generic buildings with descriptive Spanish names, without logos or trade dress.

### Terrain

El Poblado rises steeply from the river in the west to the hills in the east. This is the map's signature feature: downhill runs give speed and jumps, uphill trips cost time. Terrain is a heightfield, and roads are flattened into it.

### How the map is built

**Recommended: a hand-tuned road graph seeded from OpenStreetMap.**

1. Export the road centre lines for the area from OpenStreetMap once, at development time.
2. A script simplifies them into a road graph (nodes, edges, width, one-way flag, name) stored as JSON in the repo.
3. Edit the graph by hand for fun: widen key avenues, add shortcuts, ramps, and a few stairs or plazas that can be driven through.
4. At load time the game generates road meshes, sidewalks, and building lots from the graph.

OpenStreetMap data is ODbL-licensed, so the credits screen must attribute it. If the export is not practical, the fallback is to draw the same graph by hand from memory of the layout; the game code does not change.

Buildings are procedural low-poly blocks with a few variants per zone (towers on the Milla de Oro, low restaurants in Provenza, houses and apartment blocks in Las Lomas). About 8 landmarks get hand-made models.

## 3. Technology

| Area | Choice | Why |
|---|---|---|
| Language / build | TypeScript + Vite | Fast iteration, static output |
| Rendering | Three.js (WebGL2) | Mature, broad phone support. WebGPU is not needed for this style |
| Vehicle physics | Custom arcade model | Predictable, tunable feel and far cheaper on phones than a general physics engine |
| Collision | 2D shapes on the road plane plus terrain height sampling | Buildings and cars are boxes; a spatial grid keeps checks cheap |
| UI / HUD | HTML and CSS over the canvas | Crisp text, easy Spanish strings, accessible menus |
| Audio | Web Audio API | Synthesised engine sound, CC0 effects, original music loop |
| Storage | `localStorage` | High scores and settings; no backend |
| Hosting | GitHub Pages via GitHub Actions | Free, static, deploys from this repo |
| Tests | Vitest for game logic, Playwright for a boot-and-drive smoke test | |

All text lives in one `es.ts` strings file so a second language can be added later without touching game code.

### Driving model

The car is a single rigid body with speed, heading, and lateral slip:

- Acceleration, braking, and reverse with a speed-dependent steering curve.
- Handbrake reduces rear grip to start a drift; drifting is easy to enter and easy to recover.
- Slope affects acceleration; cresting a hill at speed leaves the ground.
- Crashes are forgiving: the taxi bounces and loses speed, never gets destroyed, and can always be reset onto the road.

### Traffic and pedestrians

- Traffic cars follow the road graph on lanes, stop for cars ahead, and are knocked aside on impact.
- Density scales with the quality setting.
- Pedestrians are sidewalk decoration and jump out of the way; they cannot be hit.

## 4. Controls

All three input methods feed one input state (steer −1…1, throttle, brake, handbrake), so the game code does not care which is in use. The method switches automatically on the last input received.

| Action | Keyboard | Mouse | Touch |
|---|---|---|---|
| Steer | A / D or ← / → | Pointer position left or right of screen centre | Left thumb: horizontal drag pad |
| Accelerate | W or ↑ | Left button held | Right thumb: **Acelerar** button |
| Brake / reverse | S or ↓ | Right button held | Right thumb: **Frenar** button |
| Handbrake / drift | Space | Middle button or Shift | **Derrape** button |
| Pause | Esc or P | On-screen button | On-screen button |
| Reset onto road | R | On-screen button | On-screen button |

Touch details:

- Landscape orientation is required; portrait shows a "gira tu teléfono" prompt.
- An **auto-acelerar** option (on by default on phones) leaves only steering, brake, and drift to manage.
- Controls respect safe-area insets and are sized for thumbs (at least 64 px).
- Browser gestures (scroll, zoom, long-press menu) are disabled on the game surface.

## 5. Performance targets

- 60 fps on a mid-range phone from the last four years; 30 fps minimum on low-end devices.
- Under 150 draw calls: instanced buildings, traffic, and props; merged static road geometry.
- Initial download under 5 MB compressed.
- Three quality levels (*Baja / Media / Alta*) controlling pixel ratio cap, shadow quality, draw distance, and traffic density. The level is auto-selected from a short benchmark on first load and can be changed in settings.
- Distance fog hides the draw limit and suits the valley haze.

## 6. Project structure

```
src/
  main.ts            boot, game loop
  game/              state machine: menu, playing, paused, results
  input/             keyboard, mouse, touch -> shared input state
  vehicle/           arcade car physics, camera
  world/             road graph, terrain, buildings, landmarks
  traffic/           traffic cars, pedestrians
  mission/           passengers, destinations, clocks, scoring
  ui/                HUD, menus, touch controls
  audio/
  i18n/es.ts
tools/               OSM-to-road-graph script
public/assets/       models, textures, sounds
tests/
```

## 7. Milestones

Each milestone ends with something playable and deployed.

| # | Milestone | Delivers | Done when |
|---|---|---|---|
| 0 | Skeleton | Vite + TypeScript + Three.js project, CI, GitHub Pages deploy | A lit scene loads from the public URL on desktop and phone |
| 1 | Driving | Taxi on a flat test grid, chase camera, all three input methods | The taxi is fun to drive and drift with keyboard, mouse, and touch |
| 2 | Map | Road graph, terrain with slope, procedural buildings, collision | The player can drive from the metro station up to Las Lomas without falling through anything |
| 3 | Taxi loop | Passengers, destinations, arrow, clocks, fares, results screen | A full shift can be played from menu to rank |
| 4 | Living city | Traffic, pedestrians, tips, combos, landmarks | Near-misses and crashes affect score; landmarks are recognisable |
| 5 | Polish | Audio, Spanish UI pass, settings, quality levels, high scores, tutorial prompts | A new player on a phone understands the game without instructions |
| 6 | Release | Performance pass, device testing, installable PWA, credits | Performance targets are met on the test devices |

Milestone 1 carries the most risk for fun, and milestone 2 the most risk for effort. Driving feel is tuned on a test grid before any map work so that the map is built to suit the car.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Driving does not feel good | Tune in milestone 1 with a live tuning panel before building anything on top |
| Map takes too long | Start with a 1 × 1 km core (Parque Lleras to Avenida El Poblado), expand only after the loop is fun |
| Phone performance | Draw-call budget from day one; test on a real phone at every milestone |
| Touch steering feels imprecise | Auto-accelerate default, steering assist that eases toward the road direction, adjustable sensitivity |
| Steep terrain breaks traffic or physics | Cap road gradient when flattening roads into the heightfield |

## 9. Decisions needed

These have a recommended default; the plan proceeds with the default unless changed.

1. **Map fidelity**: stylised and recognisable (recommended) or street-accurate. Accurate costs much more and usually plays worse.
2. **Art style**: bright low-poly with flat colours (recommended) or textured semi-realistic. Low-poly is faster to make and runs better on phones.
3. **Online features**: local high scores only (recommended for the first release) or an online leaderboard, which needs a backend.
4. **Hosting**: GitHub Pages from this repository (recommended) or another host.
