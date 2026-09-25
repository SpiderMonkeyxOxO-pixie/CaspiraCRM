// Whether the signed-in member has any platform permission (System Owner or
// a delegated platform role), from GET /admin/platform/access. Drives the
// "Platform Operations" navigation entry only; the API checks every request.
import { useEffect, useState } from "react";
import * as api from "./backendPlatformClient";

let cache = null;
export function loadPlatformAccess() {
  if (!api.PLATFORM_MODE_ENABLED) return Promise.resolve(null);
  cache ||= api.platformAccess().catch(() => null);
  return cache;
}
export function resetPlatformAccess() { cache = null; }

export function usePlatformAccess() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    loadPlatformAccess().then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, []);
  return data;
}

export const hasPlatformAccess = (data) => !!data && (data.systemOwner || (data.permissions || []).length > 0);
