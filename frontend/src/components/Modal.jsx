import { X } from "lucide-react";

/** Bottom sheet on phones, centred dialog on larger screens. */
export default function Modal({ title, onClose, children, tone = "default", dismissible = true }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-3xl ${
          tone === "alert" ? "ring-4 ring-orange-400" : ""
        }`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
