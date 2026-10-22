// Build per i test end-to-end: tempi del giro brevissimi e portale finto su localhost:8799. Mai usarla davvero.
import { execSync } from 'node:child_process';

execSync('npx wxt build', { stdio: 'inherit', env: { ...process.env, WXT_SWEEP_FAST: '1', WXT_PORTAL_URL: 'http://localhost:8799' } });
