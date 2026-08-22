export type UserRole = "OWNER" | "ADMIN" | "ACCOUNTS" | "DATA_ENTRY" | "VIEW_ONLY";

export type Permission =
  | "manage_company"
  | "manage_users"
  | "view_audit"
  | "view_parties"
  | "edit_parties"
  | "view_bookings"
  | "create_bookings"
  | "edit_bookings"
  | "void_bookings"
  | "view_payments"
  | "edit_payments"
  | "view_statements";

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner / Master",
  ADMIN: "Admin",
  ACCOUNTS: "Accounts",
  DATA_ENTRY: "Data Entry",
  VIEW_ONLY: "View Only",
};

export const EMPLOYEE_ROLES: UserRole[] = ["ADMIN", "ACCOUNTS", "DATA_ENTRY", "VIEW_ONLY"];

const ALL: Permission[] = [
  "manage_company",
  "manage_users",
  "view_audit",
  "view_parties",
  "edit_parties",
  "view_bookings",
  "create_bookings",
  "edit_bookings",
  "void_bookings",
  "view_payments",
  "edit_payments",
  "view_statements",
];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: ALL,
  ADMIN: [
    "view_audit",
    "view_parties",
    "edit_parties",
    "view_bookings",
    "create_bookings",
    "edit_bookings",
    "void_bookings",
    "view_payments",
    "edit_payments",
    "view_statements",
  ],
  ACCOUNTS: ["view_parties", "view_bookings", "view_payments", "edit_payments", "view_statements"],
  DATA_ENTRY: ["view_parties", "edit_parties", "view_bookings", "create_bookings", "edit_bookings"],
  VIEW_ONLY: ["view_parties", "view_bookings", "view_statements"],
};

export function hasPermission(role: string | null | undefined, permission: Permission) {
  if (!role) return false;
  const typed = role as UserRole;
  return Boolean(ROLE_PERMISSIONS[typed]?.includes(permission));
}

export function roleDescription(role: UserRole) {
  switch (role) {
    case "OWNER":
      return "Master company account with full control, user management and company settings.";
    case "ADMIN":
      return "Full day-to-day operations, but cannot create users or change master company security.";
    case "ACCOUNTS":
      return "Accounts-focused access for payments, statements and viewing booking/account data.";
    case "DATA_ENTRY":
      return "Can create/edit parties and bookings, but cannot void bookings or manage payments/security.";
    case "VIEW_ONLY":
      return "Read-only access to permitted business information and statements.";
  }
}

export function permissionsForRole(role: UserRole) {
  return [...ROLE_PERMISSIONS[role]];
}
