interface RefCellProps {
  id: string | null;
}

/** Short foreign-key reference: full id in the tooltip, slug preview visible. */
export function RefCell({ id }: RefCellProps) {
  if (!id) return <span className="cc-muted">—</span>;
  return (
    <code className="cc-ref" title={id}>
      {id.slice(0, 8)}
    </code>
  );
}