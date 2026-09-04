import { accessDaysRemaining, formatAccessEndsAt, shouldShowAccessExpiryBanner } from "./companyAccess";

type Props = {
  accessEndsAt: string | null | undefined;
};

/** Agency workspace banner when access ends within 7 days. */
export default function AccessExpiryBanner({ accessEndsAt }: Props) {
  if (!shouldShowAccessExpiryBanner(accessEndsAt)) return null;
  const days = accessDaysRemaining(accessEndsAt) ?? 0;
  const when = formatAccessEndsAt(accessEndsAt);
  const label =
    days === 0
      ? `Access ends today (${when}). Contact support to extend.`
      : days === 1
        ? `Access ends tomorrow (${when}). Contact support to extend.`
        : `Access ends in ${days} days (${when}). Contact support to extend.`;

  return (
    <div className="access-expiry-banner" role="status">
      {label}
    </div>
  );
}
