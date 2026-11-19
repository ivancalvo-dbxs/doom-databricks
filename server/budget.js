export const intervalMs = activeSessions => Math.max(400, Math.ceil(activeSessions * 1000 / 18));

export function createBudget() {
  let starts = [];
  return {
    take() {
      const now = Date.now();
      starts = starts.filter(time => now - time < 1000);
      if (starts.length >= 18) return false;
      starts.push(now);
      return true;
    },
  };
}
