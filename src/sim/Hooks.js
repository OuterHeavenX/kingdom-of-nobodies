// Extension points for the daily and hourly schedules. Milestone 5 systems
// (finance, institutions, warfare, foreign citizens, weather) register here so
// the orchestrator stays small and the order of work stays explicit:
//   early  - after town growth, before the market and households settle
//   late   - after housing, at the end of the day's bookkeeping
export const dailyHooks = { early: [], late: [], developmentFunding: null };
export const hourlyHooks = [];
