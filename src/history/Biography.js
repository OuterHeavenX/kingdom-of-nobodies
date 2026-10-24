import { dateLabel, yearOf, ageOn } from '../core/Calendar.js';
import { person } from '../citizens/FamilyTree.js';

// Biographies are assembled only from recorded facts: dates, family links,
// employment history and achievements written at the moment they happened.

export function biography(state, id) {
  const p = person(state, id);
  if (!p) return null;
  const living = state.citizens.includes(p);
  const name = (x) => (x ? `${x.firstName} ${x.lastName}` : null);
  const spouses = [p.family.spouseId, ...(p.family.formerSpouseIds ?? [])].filter(Boolean).map((sid) => person(state, sid)).filter(Boolean);
  const children = (p.family.childIds ?? []).map((cid) => person(state, cid)).filter(Boolean);
  const parents = (p.family.parentIds ?? []).map((pid) => person(state, pid)).filter(Boolean);
  const jobs = [...new Set((p.employmentHistory ?? []).map((e) => (e.role === 'owner' ? `owner of ${e.name}` : `worked at ${e.name}`)))];
  const ach = p.achievements ?? [];
  const founded = ach.filter((a) => a.type === 'inherited_business' || a.type === 'founded');
  const title = ach.find((a) => a.type === 'elected')?.text.replace(/ in Year.*/, '') ?? ach.find((a) => a.type === 'discovery')?.text ??
    (jobs.find((j) => j.startsWith('owner of')) ? `Founder of ${jobs.find((j) => j.startsWith('owner of')).slice(9)}` : p.profession);
  const born = p.bornHere ? `born in the village in Year ${yearOf(p.birthDay)}` : p.founder ? `one of the five founders who lit the first hearth` : `arrived in Year ${yearOf(p.arrivedDay ?? 1)}`;
  const sentences = [];
  sentences.push(`${p.firstName} ${p.lastName} was ${born}${parents.length ? `, child of ${parents.map(name).join(' and ')}` : ''}.`);
  if (jobs.length) sentences.push(`${p.sex === 'F' ? 'She' : 'He'} ${jobs.slice(0, 3).join(', then ')}.`);
  const notable = ach.filter((a) => !['married', 'trained'].includes(a.type)).slice(0, 4).map((a) => `${a.text} (Year ${yearOf(a.day)})`);
  if (notable.length) sentences.push(`Remembered for: ${notable.join('; ')}.`);
  if (spouses.length) sentences.push(`Married to ${spouses.map(name).join(', later ')}${children.length ? `, with ${children.length} child${children.length > 1 ? 'ren' : ''}: ${children.map((c) => c.firstName).join(', ')}` : ''}.`);
  else if (children.length) sentences.push(`Parent of ${children.map((c) => c.firstName).join(', ')}.`);
  if (p.status === 'dead') sentences.push(`Died of ${p.cause} in Year ${yearOf(p.deathDay)}, aged ${p.ageAtEnd}.`);
  if (p.status === 'emigrated') sentences.push(`Left the village in Year ${yearOf(p.leftDay)}.`);
  if (living) sentences.push(`Still living, aged ${ageOn(p.birthDay, state.day)}.`);
  return {
    id: p.id, name: name(p), title, living, founder: !!p.founder,
    born: dateLabel(p.birthDay), died: p.deathDay ? dateLabel(p.deathDay) : null, cause: p.cause ?? null,
    occupation: p.profession, spouses: spouses.map((s) => ({ id: s.id, name: name(s) })), children: children.map((c) => ({ id: c.id, name: name(c) })),
    parents: parents.map((x) => ({ id: x.id, name: name(x) })), achievements: ach, text: sentences.join(' '), businesses: founded,
  };
}
