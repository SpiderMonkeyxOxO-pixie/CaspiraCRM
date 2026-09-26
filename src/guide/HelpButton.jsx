import { HelpCircle } from "lucide-react";
import { useGuide } from "./GuideContext";

// "Guide" in the top bar: help for the current page and the User guide.
export default function HelpButton() {
  const g = useGuide();
  return (
    <button type="button" data-tour="nav-guide" onClick={g.openPanel} aria-label="Open the guide" title="How to use this page and the system"
      className="h-10 px-3 flex items-center gap-1.5 rounded-full bg-[#282e3c61] cursor-pointer text-sm font-medium">
      <HelpCircle size={18} /> Guide
    </button>
  );
}
