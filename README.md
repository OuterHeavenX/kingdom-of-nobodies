# Kingdom of Nobodies — Milestone 1: First Hearth

A mobile-friendly Three.js browser simulation featuring a low-poly medieval village, autonomous inhabitants, evolving resources, relationships, a village chronicle, council actions, and persistent local saving.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the address printed by Vite. To create production assets:

```bash
npm run build
npm run preview
```

## Controls

- Drag / one-finger swipe to rotate camera
- Mouse wheel / two-finger pinch to zoom
- Two-finger pan to move camera target
- Tap a villager or their name to select
- Pause, adjust speed, hold a feast, give aid, build cottages, save or reset from the council bar

## Project layout

- `index.html`: small HTML shell, no game code
- `src/main.js`: application wiring
- `src/sim/Simulation.js`: villager behavior, resources, events and decisions
- `src/world/World.js`: Three.js renderer, lighting, camera and selection
- `src/world/Buildings.js`: procedural low-poly buildings and scenery
- `src/world/Villagers.js`: villager meshes and movement
- `src/ui/HUD.js`: interaction and live panels
- `src/core/Save.js`: local persistence
- `src/style.css`: responsive presentation

## Known limitations

This is a first milestone prototype, not a full generational simulation. Citizens have simple utility rules and friendship counters; business ownership, family trees, AI dialogue, elections and construction queues are future milestones. Save data uses localStorage, so clearing browser data deletes saves. A live browser playtest and production build have not yet been verified in the hosted environment.

## Deployment

Cloudflare Pages: build command `npm run build`, output directory `dist`. Choose the GitHub repository for automatic builds.
