import { createApp } from './app';
import { config } from './config';
import { assertAdminBypassSafe, adminBypassEnabled } from './admin/bypass';
import { assertEnvIsSane } from './lib/envRules';
import { log } from './lib/logger';

// Fail fast and loudly on an unsafe production environment rather than
// serving placeholder configuration or missing credentials.
assertEnvIsSane();
// Second, independent fence: ADMIN_BYPASS_AUTH disables all Admin
// authorization and must never survive a production boot.
assertAdminBypassSafe();

const app = createApp();

app.listen(config.port, () => {
  log({ msg: 'football-api listening', port: config.port, env: process.env.NODE_ENV ?? 'development' });
  if (adminBypassEnabled()) {
    log({
      msg: 'WARNING: ADMIN_BYPASS_AUTH is active - every /api/v1/admin/* request is granted super_admin without authentication',
      env: process.env.NODE_ENV ?? 'development',
    });
  }
});