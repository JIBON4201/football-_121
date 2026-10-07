interface StatusPillProps {
  status: string;
}

/** Status as a quiet pill; palette matches the dashboard's scoped styles. */
export function StatusPill({ status }: StatusPillProps) {
  return (
    <span className="cc-badge" data-status={status}>
      {status}
    </span>
  );
}