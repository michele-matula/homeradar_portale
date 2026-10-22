// Deploy del Worker con la versione (commit corrente) negli errori del server.
import { execSync, spawnSync } from 'node:child_process';

let version = 'dev';
try {
  version = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'dev';
} catch {
  // Fuori da git: resta "dev".
}
const r = spawnSync('npx', ['wrangler', 'deploy', '--var', `VERSION:${version}`, ...process.argv.slice(2)], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
