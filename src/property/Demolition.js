// Demolition is a construction project of kind 'demolition': it takes builder
// shifts, salvages some timber for the owner and leaves a clear plot.
import { startProject } from './Construction.js';

export function startDemolition(state, plotId, ownerId) {
  return startProject(state, { plotId, ownerId, kind: 'demolition' });
}
