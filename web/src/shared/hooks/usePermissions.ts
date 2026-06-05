import { useAuth } from "../../features/auth";

export interface Permissions {
  canSeeDashboardFinancials: boolean;
  canSeeReportsAmounts:      boolean;
  canSeePLPanel:             boolean;
}

const ALL_ALLOWED: Permissions = {
  canSeeDashboardFinancials: true,
  canSeeReportsAmounts:      true,
  canSeePLPanel:             true,
};

export function usePermissions(): Permissions {
  const { myProfile } = useAuth();
  const role = myProfile?.role ?? "mechanic";

  // owner sees everything; non-admin roles use existing role-based access control
  if (role !== "admin") return ALL_ALLOWED;

  // admin: respect per-user permissions (default true when not explicitly false)
  const p = myProfile?.permissions;
  return {
    canSeeDashboardFinancials: p?.dashboard_financials !== false,
    canSeeReportsAmounts:      p?.reports_amounts      !== false,
    canSeePLPanel:             p?.pl_panel             !== false,
  };
}
