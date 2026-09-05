import { COMPANY_SUSPENDED_MESSAGE, isCompanySuspended } from "./companyStatus";

export default function SuspendedAccountBanner({ status }: { status?: string | null }) {
  if (!isCompanySuspended(status)) return null;
  return (
    <div className="access-expiry-banner" role="status">
      {COMPANY_SUSPENDED_MESSAGE} You can view records, but you cannot create bookings, payments, or open statements.
    </div>
  );
}
