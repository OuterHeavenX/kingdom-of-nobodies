// Institutions (banks, guilds and faith communities) are legal persons: each
// has its own ledger account under its id and may own land and commission
// buildings, exactly like a citizen or the council. This registry answers
// "does this institution still exist?" and "what is it called?" for the
// systems that deal with owners (construction, property, courts).

export const isBankId = (id) => typeof id === 'string' && id.startsWith('bnk');
export const isGuildId = (id) => typeof id === 'string' && id.startsWith('gld');
export const isFaithId = (id) => typeof id === 'string' && id.startsWith('fth');
export const isInstitutionId = (id) => isBankId(id) || isGuildId(id) || isFaithId(id);
/** Voluntary societies (v0.5.3) keep a purse but never own land, so they are not land-holding institutions. */
export const isSocietyId = (id) => typeof id === 'string' && id.startsWith('soc');

export function institutionById(state, id) {
  if (isBankId(id)) return state.finance?.banks.find((b) => b.id === id) ?? null;
  if (isGuildId(id)) return state.guilds?.list.find((g) => g.id === id) ?? null;
  if (isFaithId(id)) return state.faith?.communities.find((f) => f.id === id) ?? null;
  if (isSocietyId(id)) return state.divine?.societies.find((x) => x.id === id) ?? null;
  return null;
}

/** An institution that still operates (a failed bank or dissolved guild does not). */
export function institutionActive(state, id) {
  const inst = institutionById(state, id);
  return !!inst && inst.status !== 'FAILED' && inst.status !== 'DISSOLVED';
}

export const institutionName = (state, id) => institutionById(state, id)?.name ?? null;

/** Can this owner id hold land right now (council, a living citizen, or an active institution)? */
export function validOwner(state, id) {
  if (id === 'council') return true;
  if (isInstitutionId(id)) return institutionActive(state, id);
  return state.citizens.some((c) => c.id === id);
}
