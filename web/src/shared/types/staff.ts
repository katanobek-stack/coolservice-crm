export type StaffRole = "owner" | "admin" | "manager" | "mechanic";

export const ROLE_HIERARCHY: Record<StaffRole, number> = {
  owner:    100,
  admin:    80,
  manager:  50,
  mechanic: 20,
};

export function hasPermission(userRole: StaffRole, requiredRole: StaffRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export interface StaffMember {
  id: string;
  name?: string;
  role?: StaffRole;
  email?: string;
  fcmTokens?: string[];
  fcmUpdatedAt?: string;
}

export interface StaffProfileInput {
  name: string;
  role: StaffRole;
  email?: string;
}
