import { useEffect, useState } from "react";
import { CRM_TEAM } from "../Helpers/mockUsersData";
import { BACKEND_CRM_MODE_ENABLED, BACKEND_CRM_SALES_MODE_ENABLED } from "../Helpers/backendCrmClient";
import { fetchCrmOwners } from "../Helpers/crmBackendCommon";

// Owner choices for CRM pickers: the mock roster in mock mode, the active
// organization's real members (ids are membership ids) in backend mode.
// Same { id, name, role } shape either way. `backend` defaults to "either
// backend flag is on"; pass the flag of the page's own module to be exact.
export default function useCrmOwnerOptions(backend = BACKEND_CRM_MODE_ENABLED || BACKEND_CRM_SALES_MODE_ENABLED) {
  const [owners, setOwners] = useState(backend ? [] : CRM_TEAM);

  useEffect(() => {
    if (!backend) return undefined;
    let active = true;
    fetchCrmOwners().then((list) => {
      if (active) setOwners(list);
    });
    return () => {
      active = false;
    };
  }, [backend]);

  return owners;
}
