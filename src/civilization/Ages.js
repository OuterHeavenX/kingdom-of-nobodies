import { yearOf, firstDayOfYear } from '../core/Calendar.js';

// The five civilization ages. An age is opened by the calendar alone (every
// hundred years), but an age only makes things *possible*: technologies still
// have to be adopted, utilities laid and buildings rebuilt by the people who
// own them. Nothing standing changes the moment an age begins.

export const AGES = [
  { id: 1, key: 'foundations', name: 'Age of Foundations', short: 'Foundations', icon: '🏡', from: 1,
    blurb: 'Timber, thatch and stone: cottages, farms, workshops and a market square.' },
  { id: 2, key: 'industrial', name: 'Industrial Awakening', short: 'Industrial', icon: '🏭', from: 101,
    blurb: 'Brick, steam and gaslight: factories, townhouses, railways and department stores.' },
  { id: 3, key: 'modern', name: 'Modern Expansion', short: 'Modern', icon: '🚗', from: 201,
    blurb: 'Concrete and electricity: suburbs, apartments, motor cars, offices and the first high-rises.' },
  { id: 4, key: 'metropolitan', name: 'Metropolitan Age', short: 'Metropolitan', icon: '🏙️', from: 301,
    blurb: 'Steel and glass: skyscrapers, condominiums, rapid transit and smart buildings.' },
  { id: 5, key: 'tomorrow', name: 'Age of Tomorrow', short: 'Tomorrow', icon: '🌿', from: 401,
    blurb: 'Solar glass and living walls: autonomous transit, vertical gardens and sustainable towers.' },
];

export const MAX_AGE = AGES.length;
export const ageDef = (id) => AGES[Math.max(1, Math.min(MAX_AGE, id)) - 1];

/** The age the calendar has opened in a given year. */
export function ageForYear(year) {
  let id = 1;
  for (const a of AGES) if (year >= a.from) id = a.id;
  return id;
}

export const ageForDay = (day) => ageForYear(yearOf(day));
export const ageStartDay = (id) => firstDayOfYear(ageDef(id).from);

/** Years remaining until the calendar opens the next age (null in the last one). */
export function yearsToNextAge(day) {
  const next = AGES.find((a) => a.from > yearOf(day));
  return next ? next.from - yearOf(day) : null;
}
