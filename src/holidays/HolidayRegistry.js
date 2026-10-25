// The celebrations of the kingdom's year. These are fictional-world holidays
// inspired by familiar ones, placed on the kingdom's own calendar: the year
// begins with spring, so New Year's midnight is the moment Winter turns to
// Spring and the kingdom's year number really advances.
//
// Positions are given on a reference season of three 24-hour days (`day` 1-3
// and `hour`), and lengths in reference hours. HolidayCalendar scales both to
// the configured season length, so a shorter or longer calendar keeps every
// holiday in the same part of its season and in the same order.
//
// `religious` holidays carry the faith traditions that keep them most
// closely; citizens of other traditions or of none may join the public side
// of them, or keep to themselves (see culture/Holidays.js).

export const HOLIDAYS = [
  {
    id: 'newyear', name: "New Year's Eve", dayName: "New Year's Day", icon: '🎆', season: 3, day: 3, hour: 14, hours: 20,
    midnight: true, fireworks: 'midnight', gather: 'square', effects: ['fireworks', 'confetti'],
    text: 'the whole kingdom counts down to midnight in the square',
    dayText: 'confetti, lanterns and a fresh start for the kingdom',
    real: [[12, 31], [1, 1]],
  },
  {
    id: 'valentine', name: "Valentine's Day", icon: '💗', season: 0, day: 1, hour: 10, hours: 14,
    romance: true, gather: 'sweethearts', effects: ['hearts'],
    text: 'couples and friends exchange tokens and walk out together',
    real: [[2, 10], [2, 14]],
  },
  {
    id: 'stpatrick', name: "St. Patrick's Day", icon: '☘️', season: 0, day: 2, hour: 6, hours: 8,
    gather: 'square', effects: ['petals'],
    text: 'green ribbons, shamrocks and a fiddle in the square',
    real: [[3, 15], [3, 17]],
  },
  {
    id: 'spring', name: 'Spring Festival', icon: '🥚', season: 0, day: 2, hour: 14, hours: 30,
    religious: true, traditions: ['dawn', 'furrow'], gather: 'square', effects: ['petals', 'butterflies'],
    text: 'painted eggs are hidden in the grass and flowers crown the doors',
    real: 'easter',
  },
  {
    id: 'solstice', name: 'Summer Solstice', icon: '🔥', season: 1, day: 1, hour: 16, hours: 31,
    gather: 'square', effects: ['fireflies', 'sparks'],
    text: 'bonfires burn on the longest night and wreaths hang on every door',
    real: [[6, 19], [6, 23]],
  },
  {
    id: 'founders', name: "Founders' Day", icon: '🎏', season: 1, day: 3, hour: 6, hours: 18,
    fireworks: 21, gather: 'square', effects: ['fireworks'],
    text: 'flags fly for the founders, a parade rolls through town and fireworks end the day',
    real: [[7, 1], [7, 4]],
  },
  {
    id: 'harvest', name: 'Harvest Festival', icon: '🌽', season: 2, day: 1, hour: 6, hours: 40,
    gather: 'square', effects: ['leaves'],
    text: 'pumpkins, hay bales and loaded carts celebrate the year\'s harvest',
    real: [[9, 20], [9, 30]],
  },
  {
    id: 'halloween', name: 'Halloween', icon: '🎃', season: 2, day: 2, hour: 22, hours: 24,
    gather: 'houses', effects: ['leaves', 'ghosts', 'bats', 'fog'],
    text: 'jack-o\'-lanterns grin from every step and friendly ghosts drift about the square',
    real: [[10, 24], [10, 31]],
  },
  {
    id: 'gratitude', name: 'Gratitude Feast', icon: '🦃', season: 2, day: 3, hour: 22, hours: 18,
    gather: 'feast', effects: ['leaves'],
    text: 'long tables are laid for a feast of thanks',
    real: 'thanksgiving',
  },
  {
    id: 'winter', name: 'Winter Festival', icon: '🎄', season: 3, day: 1, hour: 16, hours: 46,
    religious: true, traditions: ['hearthkin', 'lantern'], gather: 'square', effects: ['snow', 'lights'],
    text: 'decorated trees, wreaths, lights and gifts warm the long nights',
    real: [[12, 1], [12, 26]],
  },
];

export const HOLIDAY_BY_ID = Object.fromEntries(HOLIDAYS.map((h) => [h.id, h]));

/** Every holiday on, unless the player turns some off. */
export const defaultEnabled = () => Object.fromEntries(HOLIDAYS.map((h) => [h.id, true]));

/** The display name for a holiday in a given phase (New Year's Eve becomes New Year's Day after midnight). */
export const holidayName = (def, phase) => (phase === 'day' && def.dayName ? def.dayName : def.name);

/** Seasons as visual themes, used by the preview tool alongside the holidays. */
export const SEASON_THEMES = [
  { id: 'season-0', name: 'Spring', icon: '🌸', season: 0 },
  { id: 'season-1', name: 'Summer', icon: '☀️', season: 1 },
  { id: 'season-2', name: 'Autumn', icon: '🍂', season: 2 },
  { id: 'season-3', name: 'Winter', icon: '❄️', season: 3 },
];

/** Benches where couples meet on Valentine's Day (open grass beside the square and on the lane to the river). */
export const SWEETHEART_SPOTS = [[3.4, 3.4], [-3.4, 3.4], [3.4, -3.4], [-3, 12.7], [3, 12.7]];
