import { buildApp } from './app.js';
import { startDashboardCacheFreshnessCron } from './cache-freshness.js';

const port = Number(process.env.PORT ?? 8080);
const app = buildApp();

try {
  await app.listen({ port, host: '0.0.0.0' });
  startDashboardCacheFreshnessCron(app.log);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
