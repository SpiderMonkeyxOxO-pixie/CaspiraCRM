import { HelpCircle } from "lucide-react";
import { useGuide } from "./GuideContext";

// The "?" in the top bar: opens help for the current page.
export default function HelpButton() {
  const g = useGuide();
  return (
    <button type="button" onClick={g.openPanel} aria-label="Help for this page" title="Help for this page"
      className="w-10 h-10 flex items-center justify-center rounded-full bg-[#282e3c61] cursor-pointer">
      <HelpCircle size={18} />
    </button>
  );
}
