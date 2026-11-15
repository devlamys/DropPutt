import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { unlockAlarm } from "../utils/alarm.js";
import { enablePush, pushState, refreshPush } from "../utils/push.js";

/**
 * "Turn on alerts": one tap that unlocks the alarm sound (browsers only allow
 * it after a tap) and asks for push permission. Once permission is granted the
 * device is re-registered silently on every launch.
 */
export default function EnableAlertsButton({ onUnlocked }) {
  const [state, setState] = useState(() => pushState());
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    void refreshPush();
  }, []);

  async function turnOn() {
    unlockAlarm();
    setSoundOn(true);
    onUnlocked?.();
    setState(await enablePush());
  }

  if (state === "granted" && soundOn) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800">
        <BellRing className="h-3.5 w-3.5" /> Alerts on
      </span>
    );
  }
  if (state === "denied") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700" title="Allow notifications for this site in the browser settings">
        <BellOff className="h-3.5 w-3.5" /> Notifications blocked
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={turnOn}
      className="flex items-center gap-1 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow active:scale-95"
    >
      <Bell className="h-3.5 w-3.5" /> {state === "granted" ? "Turn on sound" : "Turn on alerts"}
    </button>
  );
}
