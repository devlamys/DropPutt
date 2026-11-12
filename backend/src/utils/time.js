// Asia/Kolkata time helpers. Uses the ICU timezone database via Intl, so
// results never depend on the server's local timezone.

const TIME_ZONE = "Asia/Kolkata";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function istParts(date = new Date()) {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Minutes since midnight in Asia/Kolkata. */
export function istMinutesOfDay(date = new Date()) {
  const { hour, minute } = istParts(date);
  return hour * 60 + minute;
}

/** { date: "YYYY-MM-DD", start, end } — the IST calendar day containing `date`. */
export function istDayRange(date = new Date()) {
  const { ymd } = istParts(date);
  const start = new Date(`${ymd}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date: ymd, start, end };
}

/** 15:00 ≤ IST time < 18:00 (SPEC §26). */
export function isChayakadiWindow(date = new Date()) {
  const minutes = istMinutesOfDay(date);
  return minutes >= 15 * 60 && minutes < 18 * 60;
}
