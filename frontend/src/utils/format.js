export const inr = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "₹0";
  const abs = Math.abs(n);
  const text = abs.toLocaleString("en-IN", { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}₹${text}`;
};

export function minutesAgo(iso, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} m ago`;
}

export const ORDER_STATUS_LABELS = {
  RIDER_REQUESTED: "Finding rider",
  RIDER_ASSIGNED: "Rider assigned",
  PICKED_UP: "Picked up",
  LOCATION_SHARED: "On the way",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const PAYMENT_LABELS = {
  COD: "Cash on delivery",
  PREPAID_AT_HOTEL: "Prepaid at hotel",
  UPI_TO_ADMIN: "UPI to admin",
};
