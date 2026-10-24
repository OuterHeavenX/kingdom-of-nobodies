import { SOCIAL } from '../core/Config.js';

// Citizens remember a bounded set of significant personal events. Weight decides
// which memories survive when the list is full.
export function remember(state, c, text, weight = 1, kind = 'event') {
  c.memories.unshift({ day: state.day, text, weight, kind });
  if (c.memories.length > SOCIAL.maxMemories) {
    let weakest = c.memories.length - 1;
    for (let i = c.memories.length - 1; i > 2; i--) if (c.memories[i].weight < c.memories[weakest].weight) weakest = i;
    c.memories.splice(weakest, 1);
  }
}
