import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { useAlarmBlocked } from "../hooks/useAlarmBlocked.js";
import { unlockAlarm } from "../utils/alarm.js";
import { enablePush, pushState, refreshPush } from "../utils/push.js";
import Modal from "./Modal.jsx";

/**
 * A popup that asks for order alerts only while they are off: notifications not allowed yet, or the
 * browser still holding the alarm sound back (it forgets that on every launch until a tap). One tap
 * on "Turn on" unlocks the sound and asks for notification permission. Once both are on it renders
 * nothing, so the header stays clean. "Not now" hides it until the next launch.
 */
export default function AlertsPrompt() {
  const [state, setState] = useState(() => pushState());
  const { blocked: soundBlocked } = useAlarmBlocked();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Keeps this phone's push token current once allowed, then shows the real permission
    // (the Android app can only read it asynchronously).
    refreshPush().finally(() => setState(pushState()));
  }, []);

  const denied = state === "denied";
  const needsPermission = state === "default";
  if (hidden || !(needsPermission || denied || soundBlocked)) return null;

  async function turnOn() {
    setBusy(true);
    unlockAlarm();
    try {
      setState(await enablePush());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={denied ? "Notifications are blocked" : "Turn on order alerts"} onClose={() => setHidden(true)} tone="alert">
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-600">
          <BellRing className="h-8 w-8" />
        </span>
        {denied ? (
          <p className="text-sm text-slate-600">
            You will not hear new orders when this app is in the background. Allow notifications for this site in the browser settings, then reopen the app.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Get a loud alert and a phone notification for every new order, even when this app is in the background.
            </p>
            <p lang="ml" className="text-sm text-slate-600">പുതിയ ഓർഡർ വരുമ്പോൾ ശബ്ദത്തോടെ അറിയിക്കും.</p>
          </>
        )}
        {!denied && (
          <button
            type="button"
            onClick={turnOn}
            disabled={busy}
            className="mt-1 h-12 w-full rounded-2xl bg-orange-600 text-base font-bold text-white disabled:opacity-60"
          >
            {needsPermission ? "Turn on notifications" : "Turn on sound"}
          </button>
        )}
        <button type="button" onClick={() => setHidden(true)} className="h-10 text-sm font-semibold text-slate-500">
          Not now
        </button>
      </div>
    </Modal>
  );
}
