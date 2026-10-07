import type { NextApiRequest, NextApiResponse } from 'next';
import { createApp } from '../../../../backend/src/app';
import { assertEnvIsSane } from '../../../../backend/src/lib/envRules';
import { assertAdminBypassSafe } from '../../../../backend/src/admin/bypass';

// Same boot-time safety fences the standalone server applied (server.ts).
// Serverless functions never build a net new app instance per request, so a
// misconfigured production environment fails the first invocation loudly
// instead of silently serving placeholder configuration.
assertEnvIsSane();
assertAdminBypassSafe();

const app = createApp();

// Next's API routes parse JSON by default; Express must see the raw stream
// because it owns body parsing/limits/validation downstream.
export const config = {
  api: { bodyParser: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  app(req as unknown as Parameters<typeof app>[0], res as unknown as Parameters<typeof app>[1]);
}
