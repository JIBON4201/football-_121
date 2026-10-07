import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/dates';
import { sanitizeText } from '@/lib/validation';
import type { Transfer } from '@/types/api';

const STATUS_TONE: Record<string, 'info' | 'neutral' | 'warning'> = {
  completed: 'neutral',
  announced: 'info',
  cancelled: 'warning',
  rumour: 'warning',
};

/**
 * Official transfer records with backend-provided statuses shown verbatim.
 * Rumours are never upgraded: only announced/completed rows can arrive here.
 */
export function TransferRecords({ records }: { records: Transfer[] }) {
  if (records.length === 0) return null;
  return (
    <section aria-labelledby="transfer-records-heading">
      <h2 id="transfer-records-heading">Official transfer records</h2>
      <div role="region" aria-label="Official transfer records" tabIndex={0}>
        <table>
          <caption>Officially announced and completed transfers</caption>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Type</th>
              <th scope="col">Announced</th>
              <th scope="col">Effective</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>
                  <Badge tone={STATUS_TONE[record.status] ?? 'neutral'}>{sanitizeText(record.status)}</Badge>
                </td>
                <td>{record.transfer_type ? sanitizeText(record.transfer_type.replace(/_/g, ' ')) : '—'}</td>
                <td>{record.announcement_date ? formatDate(record.announcement_date) : '—'}</td>
                <td>{record.effective_date ? formatDate(record.effective_date) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
