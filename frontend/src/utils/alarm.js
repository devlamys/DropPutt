// Looping order alarm built with Web Audio (no audio asset to ship).
// Browsers only allow sound after a user gesture, so call unlock() from a
// tap (the Online toggle does this).

let ctx = null;
let timer = null;
let kind = "rider";

function getContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx ||= new Ctor();
  return ctx;
}

export function unlockAlarm() {
  const c = getContext();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

function beep(c, startAt, freq, duration) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function ring() {
  const c = getContext();
  if (c && c.state === "running") {
    const t = c.currentTime;
    if (kind === "vendor") {
      // A lower three-note chime so a shop owner can tell it from a rider's alert.
      beep(c, t, 660, 0.22);
      beep(c, t + 0.3, 880, 0.22);
      beep(c, t + 0.6, 1100, 0.3);
    } else {
      beep(c, t, 880, 0.18);
      beep(c, t + 0.25, 1175, 0.18);
      beep(c, t + 0.5, 880, 0.18);
      beep(c, t + 0.75, 1175, 0.18);
    }
  }
  navigator.vibrate?.([300, 150, 300]);
}

/** `which`: "rider" (default) or "vendor" — a different tone for each. */
export function startAlarm(which = "rider") {
  if (timer) return;
  kind = which;
  unlockAlarm();
  ring();
  timer = setInterval(ring, 1600);
}

export function stopAlarm() {
  if (timer) clearInterval(timer);
  timer = null;
  navigator.vibrate?.(0);
}
