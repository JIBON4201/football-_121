'use client';

import { Alert } from '@/components/ui/Feedback';

/** Route-level error boundary: friendly message, no internals. */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container">
      <Alert tone="error">Something went wrong loading this page.</Alert>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
