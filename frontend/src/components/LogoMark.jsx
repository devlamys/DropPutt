// DropPutt mark: a red rounded tile with a logistics cube (food box to mini-truck
// cargo) carrying the drop-point dot. Full lockup with wordmark: public/logo-full.svg.
export default function LogoMark({ size = 32, className = "" }) {
  return (
    <svg viewBox="4 6 56 56" width={size} height={size} fill="none" className={className} role="img" aria-label="DropPutt">
      <rect x="4" y="6" width="56" height="56" rx="15" fill="#E8431A" />
      <path d="M32 16L46 24V40L32 48L18 40V24L32 16Z" fill="#FFFFFF" />
      <path d="M32 16L46 24L32 32L18 24L32 16Z" fill="#FFE4DC" />
      <path d="M32 32L46 24V40L32 48V32Z" fill="#FFFFFF" fillOpacity="0.92" />
      <circle cx="32" cy="24" r="3.5" fill="#E8431A" />
      <path d="M32 32V48" stroke="#E8431A" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 24L32 32L46 24" stroke="#E8431A" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}
