import { ORDER_STATUS_LABELS } from "../utils/format.js";

const STYLES = {
  RIDER_REQUESTED: "bg-amber-100 text-amber-800 ring-amber-300",
  RIDER_ASSIGNED: "bg-blue-100 text-blue-800 ring-blue-300",
  PICKED_UP: "bg-violet-100 text-violet-800 ring-violet-300",
  LOCATION_SHARED: "bg-teal-100 text-teal-800 ring-teal-300",
  DELIVERED: "bg-green-100 text-green-800 ring-green-300",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-300",
};

export default function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
        STYLES[status] || STYLES.CANCELLED
      }`}
    >
      {status.replace("_", " ")} · {ORDER_STATUS_LABELS[status] ?? ""}
    </span>
  );
}
