// /ai/governance — the AI governance control center (Backend Phase 11).
import { useState } from "react";
import { AdminPage, Tabs } from "./AdminShell";
import { GovOverview, GovCapabilities } from "./governance/GovOverview";
import { GovPolicies } from "./governance/GovPolicies";
import { GovRegistry } from "./governance/GovRegistry";
import { KillSwitches, Flags, Exceptions, Reviews, Reports } from "./governance/GovControls";

export default function GovernancePage() {
  const [tab, setTab] = useState("overview");
  return (
    <AdminPage title="AI Governance" requires={[["ai_governance", "read"]]}
      description="Capabilities, policies, providers, models, prompts, tools, workflows, kill switches and reviews. Statuses are shown as recorded — controls existing is not a compliance certification.">
      {(access) => {
        const tabs = [
          ["overview", "Overview"], ["capabilities", "Capabilities"], ["policies", "Policies"], ["registry", "Registry"],
          ...(access.can("ai_kill_switches", "activate") || access.can("ai_governance", "read") ? [["kill", "Kill switches"]] : []),
          ["flags", "Flags"], ["exceptions", "Exceptions"],
          ...(access.can("ai_safety", "review") || access.can("ai_gov_evaluations", "review") ? [["reviews", "Review queue"]] : []),
          ["reports", "Reports"],
        ];
        const Section = { overview: GovOverview, capabilities: GovCapabilities, policies: GovPolicies, registry: GovRegistry, kill: KillSwitches, flags: Flags, exceptions: Exceptions, reviews: Reviews, reports: Reports }[tab] || GovOverview;
        return (
          <div className="space-y-4">
            <Tabs label="Governance sections" tabs={tabs} value={tab} onChange={setTab} />
            <Section access={access} canManage={access.can("ai_governance", "manage")} />
          </div>
        );
      }}
    </AdminPage>
  );
}
