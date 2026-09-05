/** Keep last KPI/feed on screen while a background reload runs. */
export function shouldShowDashboardSkeleton(hasData: boolean, loading: boolean): boolean {
  return !hasData && loading;
}
