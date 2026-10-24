const KEY = 'kingdom-of-nobodies-m1-v2';
export function loadGame() { try { const s=JSON.parse(localStorage.getItem(KEY)); return s?.version===2 && Array.isArray(s.people) && s.people.length===5 ? s : null; } catch { return null; } }
export function saveGame(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; } }
export function clearGame() { try { localStorage.removeItem(KEY); } catch {} }
