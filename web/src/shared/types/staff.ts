export type StaffRole = "admin" | "manager" | "mechanic";

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
