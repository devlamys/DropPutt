// The DropPutt brand: an isometric logistics cube (a food box, a grocery bag, mini-truck cargo)
// with a precision drop pin on top. One mark for every app; the role only changes the badge and
// the line under the name. The red is the brand colour and never follows the Mart's green theme,
// so it is fixed here instead of using the `flame` ramp.
//
//   <DropPuttLogo role="vendor" size="lg" layout="stacked" />    login screens
//   <DropPuttLogo role="rider" size="sm" iconOnly />              dense headers
//   <DropPuttLogo onDark />                                       light wordmark on a dark bar
//
// The same artwork lives in public/favicon.svg (favicon, web manifest and Android icons are
// generated from it by scripts/brand-icons.sh); keep the two in step.

export const BRAND_RED = "#E8431A";

/** Per-role badge and tagline. The customer app has no badge. */
const ROLES = {
  customer: { badge: null, subtitle: "FOOD • GROCERY • MINI-TRUCK", badgeClass: "" },
  vendor: { badge: "PARTNER", subtitle: "Hotel & Store Panel", badgeClass: "bg-emerald-600 text-white" },
  rider: { badge: "RIDER", subtitle: "Delivery Fleet App", badgeClass: "bg-slate-900 text-amber-300" },
  admin: { badge: "ADMIN", subtitle: "Franchise Control", badgeClass: "bg-red-600 text-white" },
};

const SIZES = {
  sm: { icon: 28, word: "text-base", badge: "text-[9px] px-1.5 py-px", sub: "text-[10px]" },
  md: { icon: 40, word: "text-xl", badge: "text-[10px] px-2 py-0.5", sub: "text-[11px]" },
  lg: { icon: 56, word: "text-3xl", badge: "text-xs px-2.5 py-0.5", sub: "text-xs" },
  xl: { icon: 72, word: "text-4xl", badge: "text-xs px-2.5 py-0.5", sub: "text-sm" },
};

/** The mark alone: a red tile with the cube and the pin. */
export function DropPuttMark({ size = 32, className = "" }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={className} role="img" aria-label="DropPutt">
      <rect width="64" height="64" rx="15" fill={BRAND_RED} />
      <path d="M32 26L46 34L32 42L18 34Z" fill="#FFE4DC" />
      <path d="M18 34L32 42V56L18 48Z" fill="#FFFFFF" />
      <path d="M32 42L46 34V48L32 56Z" fill="#FFC9B8" />
      <path d="M32 33.5C32 33.5 23.5 25.5 23.5 17.2a8.5 8.5 0 0 1 17 0C40.5 25.5 32 33.5 32 33.5Z" fill="#FFFFFF" stroke={BRAND_RED} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="32" cy="17.2" r="3.2" fill={BRAND_RED} />
    </svg>
  );
}

/** Just the role badge ("PARTNER", "RIDER", "ADMIN"), for headers that already carry their own title. */
export function RoleBadge({ role = "customer", size = "sm", className = "" }) {
  const info = ROLES[role] ?? ROLES.customer;
  if (!info.badge) return null;
  return (
    <span className={`inline-block rounded-full font-extrabold leading-none tracking-wider ${SIZES[size].badge} ${info.badgeClass} ${className}`}>
      {info.badge}
    </span>
  );
}

export default function DropPuttLogo({
  role = "customer",
  size = "md",
  iconOnly = false,
  layout = "inline", // "inline" (icon beside the text) | "stacked" (icon above, centred)
  showSubtitle = true,
  onDark = false, // light "Drop" for dark backgrounds
  className = "",
}) {
  const info = ROLES[role] ?? ROLES.customer;
  const dim = SIZES[size] ?? SIZES.md;
  if (iconOnly) return <DropPuttMark size={dim.icon} className={`shrink-0 ${className}`} />;

  const stacked = layout === "stacked";
  return (
    <span className={`inline-flex ${stacked ? "flex-col items-center gap-2 text-center" : "items-center gap-2.5"} ${className}`}>
      <DropPuttMark size={dim.icon} className="shrink-0" />
      <span className={`flex min-w-0 flex-col ${stacked ? "items-center" : "items-start"} leading-tight`}>
        <span className="flex items-center gap-1.5">
          <span className={`${dim.word} font-extrabold tracking-tight`}>
            <span className={onDark ? "text-white" : "text-slate-900"}>Drop</span>
            <span style={{ color: BRAND_RED }}>Putt</span>
          </span>
          <RoleBadge role={role} size={size} />
        </span>
        {showSubtitle && (
          <span className={`${dim.sub} ${info.subtitle === ROLES.customer.subtitle ? "font-bold tracking-[0.14em]" : "font-semibold"} ${onDark ? "text-white/70" : "text-slate-500"}`}>
            {info.subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
