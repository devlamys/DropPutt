import { Pill } from "lucide-react";

/** Shown wherever medicines are listed: some need a doctor's prescription. */
export default function MedicalNotice({ className = "" }) {
  return (
    <div role="note" className={`flex gap-3 rounded-xl bg-amber-50 p-3 text-amber-950 ring-1 ring-amber-200 ${className}`}>
      <Pill className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
      <p className="text-sm leading-snug">
        <b>Some medicines need a doctor's prescription.</b> The pharmacy may ask to see it, so keep it ready.
        <span className="mt-0.5 block text-xs text-amber-900/80">ചില മരുന്നുകൾക്ക് ഡോക്ടറുടെ കുറിപ്പടി ആവശ്യമാണ്; ഫാർമസി ചോദിച്ചാൽ കാണിക്കാൻ തയ്യാറാക്കി വയ്ക്കുക.</span>
      </p>
    </div>
  );
}
