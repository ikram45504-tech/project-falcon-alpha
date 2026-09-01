export type BookingListScope = {
  counterpartyId?: string;
  transactionType?: "SALE" | "PURCHASE";
  status?: "ACTIVE" | "VOID";
};

type SupabaseFilterQuery = {
  eq: (column: string, value: string) => SupabaseFilterQuery;
};

export function applyBookingListScope<T extends SupabaseFilterQuery>(query: T, scope?: BookingListScope): T {
  let next = query;
  if (scope?.counterpartyId) next = next.eq("counterparty_id", scope.counterpartyId) as T;
  if (scope?.transactionType) next = next.eq("transaction_type", scope.transactionType) as T;
  if (scope?.status) next = next.eq("status", scope.status) as T;
  return next;
}

export function bookingListScopeSql(scope?: BookingListScope, baseParamCount = 0) {
  const clauses: string[] = [];
  const params: string[] = [];
  let index = baseParamCount;

  if (scope?.counterpartyId) {
    index += 1;
    clauses.push(`AND b.counterparty_id=$${index}`);
    params.push(scope.counterpartyId);
  }
  if (scope?.transactionType) {
    index += 1;
    clauses.push(`AND b.transaction_type=$${index}`);
    params.push(scope.transactionType);
  }
  if (scope?.status) {
    index += 1;
    clauses.push(`AND b.status=$${index}`);
    params.push(scope.status);
  }

  return { sql: clauses.join(" "), params };
}
