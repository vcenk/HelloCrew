// Shown while a dashboard page streams in. Matches the shell's own
// pre-hydration skeleton so navigation never flashes a different shape.
export default function DashboardLoading() {
  return (
    <div className="dash-skeleton" role="status" aria-label="Loading this page">
      <span />
      <span />
      <span />
    </div>
  );
}
