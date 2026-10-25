import * as THREE from 'three';
import { mat, G, part, PALETTE as P } from './Materials.js';
import { soldierBlock } from './KingdomScene.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';

// A stylised replay of a recorded battle. Two small formations face each
// other on ground matching the battle's terrain; their sizes follow the
// soldiers each side brought, the clash lasts a few seconds, and the side
// that lost the simulated battle falls back while the winner's banner is
// raised. Nothing here decides anything: it only shows the record. There is
// no gore: blocks thin out as soldiers withdraw from the line.

const GROUND = { mountain: '#8a8a80', forest: '#5f8a4f', plains: '#86b06d', coast: '#c9c08e' };
const colorOf = (p) => (p === HEARTH ? '#e8c06a' : KINGDOMS[p]?.color ?? '#aaa');

export class BattleView {
  constructor(battle) {
    this.battle = battle;
    this.group = new THREE.Group();
    this.time = 0;
    const g = this.group;
    const geo = new THREE.CircleGeometry(70, 40).rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: GROUND[battle.terrain] ?? GROUND.plains, roughness: 1, flatShading: true }));
    this.ground.receiveShadow = true;
    g.add(this.ground);
    if (battle.terrain === 'mountain') for (let i = 0; i < 8; i++) part(g, G.cone(6), mat('#6f7178'), [18, 20 + i * 2, 16], [-50 + i * 14, 9, -45], null, false);
    if (battle.terrain === 'forest') for (let i = 0; i < 26; i++) { const x = -55 + (i % 13) * 9, z = i < 13 ? -32 : 32; part(g, G.cone(7), mat(P.pine), [3, 5, 3], [x, 2.5, z], null, false); }
    if (battle.fortified) for (let i = -3; i <= 3; i++) part(g, G.box(), mat(P.stoneDark), [6, 4, 1.4], [i * 6, 2, 16], null, false);
    this.sides = battle.sides.map((side, i) => {
      const n = Math.max(6, Math.min(30, Math.round(side.before / 15)));
      const block = soldierBlock(n, colorOf(side.party), i === 0);
      block.rotation.y = i === 0 ? 0 : Math.PI;
      block.position.set(0, 0, i === 0 ? -18 : 18);
      g.add(block);
      const lost = Math.round(n * (1 - side.after / Math.max(1, side.before)));
      return { side, block, n, lost, start: i === 0 ? -18 : 18, dir: i === 0 ? 1 : -1, won: side.party === battle.winner };
    });
    this.dust = [];
    for (let i = 0; i < 10; i++) { const d = part(g, G.sphere(6), mat('#d9cbb0', { transparent: true, opacity: 0.5 }), [2, 1.2, 2], [(i - 5) * 2.2, 0.8, 0], null, false); d.visible = false; this.dust.push(d); }
  }

  /** A nine-second loop: advance, clash, withdrawal, then a pause before replaying. */
  update(dt) {
    this.time = (this.time + dt) % 11;
    const t = this.time;
    for (const s of this.sides) {
      let z = s.start;
      if (t < 3) z = s.start + s.dir * (t / 3) * 13;
      else if (t < 6) z = s.start + s.dir * 13 + Math.sin(t * 9) * 0.3;
      else z = s.start + s.dir * 13 - (s.won ? -s.dir * 2 : s.dir * (t - 6) * 6);
      s.block.position.z = z;
      // Those who fall out of the line go to the rear (no gore: they simply leave the formation).
      const gone = t < 4 ? 0 : Math.min(s.lost, Math.round(s.lost * Math.min(1, (t - 4) / 2)));
      s.block.userData.soldiers.forEach((m, i) => { m.visible = i >= gone; m.position.y = t > 3 && t < 6 ? Math.abs(Math.sin(t * 10 + i)) * 0.15 : 0; });
      if (s.won && t > 7) s.block.children.at(-1).scale.y = 1 + Math.sin(t * 4) * 0.08;
    }
    for (const [i, d] of this.dust.entries()) { d.visible = t > 3 && t < 6.5; d.scale.setScalar(1 + ((t * 2 + i) % 1.5)); }
  }

  dispose() { this.ground.geometry.dispose(); this.ground.material.dispose(); this.group.clear(); }
}
