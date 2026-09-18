// About 20 Google Ads search operations per store for each four-day refresh.
// Reserve headroom below Explorer's daily 2,880-operation allowance.
export function refreshIntervalMinutes(storeCount: number) {
  return Math.max(15, Math.ceil((storeCount * 20 * 1440) / 1800 / 15) * 15);
}
