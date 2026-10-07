/** Step 4 — Admin audit-log read service (append-only table, newest first). */
import { adminList, type AdminListInput } from './_list';

const COLUMNS = 'id,user_id,action,entity_type,entity_id,ip_address,user_agent,created_at';

export interface AdminAuditLogsInput extends AdminListInput {
  action?: string;
  entity_type?: string;
  user_id?: string;
}

export const adminAuditLogsService = {
  list: (input: AdminAuditLogsInput) =>
    adminList(
      'audit_logs',
      COLUMNS,
      input,
      (query) => {
        let q = query;
        if (input.action) q = q.eq('action', input.action);
        if (input.entity_type) q = q.eq('entity_type', input.entity_type);
        if (input.user_id) q = q.eq('user_id', input.user_id);
        return q;
      },
      (query) => query.order('created_at', { ascending: false }),
    ),
};
