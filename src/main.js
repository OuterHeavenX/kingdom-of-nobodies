import './style.css';
import {Simulation} from './sim/Simulation.js';
import {World} from './world/World.js';
import {HUD} from './ui/HUD.js';
import {loadGame,saveGame,clearGame} from './core/Save.js';
let sim=new Simulation(loadGame());
const world=new World(document.getElementById('world'),sim);
let hud=new HUD(sim,()=>saveGame(sim.state),()=>{clearGame();location.reload()});
let last=performance.now();
function frame(now){const dt=Math.min(.1,(now-last)/1000);last=now;sim.update(dt);world.render(dt,now/1000);requestAnimationFrame(frame)}
requestAnimationFrame(frame);
setInterval(()=>saveGame(sim.state),20000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame(sim.state)});
window.addEventListener('pagehide',()=>saveGame(sim.state));
