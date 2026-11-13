// When an order counts as "stuck". Shared by the sweep job and the admin board.
//
// Overridable per deployment; invalid or non-positive values fall back to the default.

function minutes(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const staleRules = Object.freeze({
  // Nobody accepted yet: ring the riders again after this long, then every interval.
  redispatchAfterMinutes: minutes("STALE_REDISPATCH_MINUTES", 10),
  // Still nobody: give up and cancel (the customer is told, the shop's board clears).
  autoCancelAfterMinutes: minutes("STALE_AUTO_CANCEL_MINUTES", 30),
  // A rider holds the order but it has not been delivered: flag it to the admin.
  // Never auto-cancelled — the rider may be carrying the goods.
  stuckActiveAfterMinutes: minutes("STUCK_ACTIVE_MINUTES", 240),
});

export const minutesAgo = (now, mins) => new Date(now.getTime() - mins * 60_000);
