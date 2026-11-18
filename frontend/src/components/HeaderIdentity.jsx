import DropPuttLogo, { RoleBadge } from "./DropPuttLogo.jsx";

/**
 * Who this app is for, shown at the left of the vendor, rider and admin headers:
 * small logo, the name (or any element, e.g. a franchise picker) and the role badge,
 * with `children` (connection status) beside the badge.
 */
export default function HeaderIdentity({ role, title, badge, children }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <DropPuttLogo role={role} iconOnly size="sm" />
      <div className="min-w-0">
        {typeof title === "string" || title == null ? <h1 className="truncate text-lg font-bold leading-tight">{title || " "}</h1> : title}
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          <RoleBadge role={role} label={badge} />
          {children}
        </p>
      </div>
    </div>
  );
}
