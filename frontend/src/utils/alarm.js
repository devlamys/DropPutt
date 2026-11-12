// Looping order alarm built with Web Audio (no audio asset to ship).
// Browsers only allow sound after a user gesture, so call unlock() from a
// tap (the Online toggle does this).

let ctx = null;
let timer = null;

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
    beep(c, t, 880, 0.18);
    beep(c, t + 0.25, 1175, 0.18);
    beep(c, t + 0.5, 880, 0.18);
    beep(c, t + 0.75, 1175, 0.18);
  }
  navigator.vibrate?.([300, 150, 300]);
}

export function startAlarm() {
  if (timer) return;
  unlockAlarm();
  ring();
  timer = setInterval(ring, 1600);
}

export function stopAlarm() {
  if (timer) clearInterval(timer);
  timer = null;
  navigator.vibrate?.(0);
}
