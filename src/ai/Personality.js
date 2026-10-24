// Personality traits are numeric strengths from 0 to 1. Missing traits count as 0.
export const TRAITS = ['ambitious', 'generous', 'greedy', 'honest', 'dishonest', 'friendly', 'shy',
  'hardworking', 'lazy', 'curious', 'riskTaking', 'loyal', 'jealous', 'frugal', 'creative', 'stubborn'];

export const TRAIT_LABELS = {
  ambitious: 'Ambitious', generous: 'Generous', greedy: 'Greedy', honest: 'Honest', dishonest: 'Dishonest',
  friendly: 'Friendly', shy: 'Shy', hardworking: 'Hardworking', lazy: 'Lazy', curious: 'Curious',
  riskTaking: 'Risk-taking', loyal: 'Loyal', jealous: 'Jealous', frugal: 'Frugal', creative: 'Creative', stubborn: 'Stubborn',
};

// Pairs that cannot both be strong in one person.
const OPPOSITES = [['honest', 'dishonest'], ['friendly', 'shy'], ['hardworking', 'lazy'], ['generous', 'greedy'], ['frugal', 'riskTaking']];

export const trait = (c, name) => c.traits[name] ?? 0;

export function topTraits(c, n = 3) {
  return Object.entries(c.traits).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => TRAIT_LABELS[k]);
}

export function randomTraits(rand) {
  const traits = {};
  const pool = [...TRAITS];
  const count = 3 + Math.floor(rand() * 2);
  while (Object.keys(traits).length < count && pool.length) {
    const name = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const clash = OPPOSITES.find(([a, b]) => (a === name && traits[b]) || (b === name && traits[a]));
    if (!clash) traits[name] = Math.round((0.35 + rand() * 0.6) * 100) / 100;
  }
  return traits;
}
