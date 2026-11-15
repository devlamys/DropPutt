// Looping order alarm built with Web Audio (no audio asset to ship).
// Browsers only allow sound after a user gesture. The Online / "Turn on alerts"
// buttons call unlockAlarm(), and so does the first tap, key press or touch
// anywhere on the page (installed below), so a shop that forgot to turn sound
// on still hears the next order after touching the screen once.

let ctx = null;
let timer = null;
let kind = "rider";

function getContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx ||= new Ctor();
  return ctx;
}

const listeners = new Set();
function notify() {
  for (const listener of listeners) listener(alarmBlocked());
}

export function unlockAlarm() {
  const c = getContext();
  if (!c) return;
  if (!c.onstatechange) c.onstatechange = notify;
  if (c.state === "suspended") c.resume().catch(() => {});
}

/** True while the browser is still holding sound back (no tap yet). */
export function alarmBlocked() {
  const c = getContext();
  return !c || c.state !== "running";
}

/** Calls `callback(blocked)` whenever the sound lock opens or closes; returns an unsubscribe. */
export function onAlarmBlockedChange(callback) {
  listeners.add(callback);
  getContext()?.addEventListener?.("statechange", notify);
  return () => listeners.delete(callback);
}

if (typeof window !== "undefined") {
  const unlockOnTouch = () => {
    unlockAlarm();
    if (!alarmBlocked()) {
      for (const type of ["pointerdown", "touchstart", "keydown"]) {
        window.removeEventListener(type, unlockOnTouch, true);
      }
    }
  };
  for (const type of ["pointerdown", "touchstart", "keydown"]) {
    window.addEventListener(type, unlockOnTouch, true);
  }
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
