// Page guides: what each page is for, what its parts do, and an optional
// step-by-step tour. One file per module under ./content; each exports an
// array of guides:
//
//   { path: "/crm/leads",            // react-router pattern (":id" allowed)
//     title: "Leads",
//     purpose: "One or two sentences: what this page is for.",
//     sections: [{ heading, body }], // the parts of the page, in plain words
//     tips: ["…"],                   // optional short tips
//     tour: [{ target, title, body }] }
//
// A tour step's `target` is the value of a data-tour="…" attribute on the page.
// A step without a target (or whose element isn't on screen) is shown in the
// middle of the page, so a tour never breaks when a part is hidden.
import { matchPath } from "react-router-dom";
import general from "./content/general";
import crm from "./content/crm";
import sales from "./content/sales";
import support from "./content/support";
import projects from "./content/projects";
import marketing from "./content/marketing";
import finance from "./content/finance";
import insights from "./content/insights";

const ALL = [...crm, ...sales, ...support, ...projects, ...marketing, ...finance, ...insights, ...general];

// The most specific guide for a location: exact patterns first, then the
// module-level fallbacks ("/crm/*").
export function guideFor(pathname, guides = ALL) {
  const exact = guides.find((g) => !g.path.endsWith("*") && matchPath({ path: g.path, end: true }, pathname));
  if (exact) return exact;
  return guides.find((g) => g.path.endsWith("*") && matchPath({ path: g.path, end: false }, pathname)) || null;
}

export const allGuides = () => ALL;
