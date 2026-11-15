import { useEffect, useState } from "react";
import { alarmBlocked, onAlarmBlockedChange, unlockAlarm } from "../utils/alarm.js";

/** { blocked, unlock }: whether the browser is still holding the alarm sound back. */
export function useAlarmBlocked() {
  const [blocked, setBlocked] = useState(() => alarmBlocked());
  useEffect(() => {
    setBlocked(alarmBlocked());
    const off = onAlarmBlockedChange(setBlocked);
    // The state change event is not fired everywhere: re-check shortly after a tap.
    const id = setInterval(() => setBlocked(alarmBlocked()), 700);
    return () => {
      off();
      clearInterval(id);
    };
  }, []);
  return { blocked, unlock: () => { unlockAlarm(); setBlocked(alarmBlocked()); } };
}
