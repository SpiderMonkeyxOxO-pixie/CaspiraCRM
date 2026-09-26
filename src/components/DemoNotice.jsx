import { Info } from "lucide-react";

// Shown on modules that still run on built-in sample data: nothing entered
// there reaches the server, so people shouldn't rely on it.
export default function DemoNotice({ module }) {
  return (
    <div role="note" className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <Info size={16} className="mt-0.5 shrink-0" />
      <p>
        <strong>{module} is a preview.</strong> It shows sample data and isn&apos;t connected to the server yet, so anything
        you add or change here is not saved and is gone when you reload the page.
      </p>
    </div>
  );
}
