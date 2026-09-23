import { useEffect, useState } from "react";
import { CRM_TEAM } from "../Helpers/mockUsersData";
import { BACKEND_CRM_MODE_ENABLED, fetchCrmOwners } from "../Helpers/crmLeadsBackend";

// Owner choices for CRM pickers: the mock roster in mock mode, the active
// organization's real members (ids are membership ids) in backend mode.
// Same { id, name, role } shape either way.
export default function useCrmOwnerOptions() {
  const [owners, setOwners] = useState(BACKEND_CRM_MODE_ENABLED ? [] : CRM_TEAM);

  useEffect(() => {
    if (!BACKEND_CRM_MODE_ENABLED) return undefined;
    let active = true;
    fetchCrmOwners().then((list) => {
      if (active) setOwners(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return owners;
}
