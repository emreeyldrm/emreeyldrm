// `npm run start:e2e`: boş bir yerel D1 ile Worker'ı 8790 portunda ön planda başlatır.
// Durum yalnızca .wrangler/e2e altında tutulur ve her başlatmada sıfırlanır (geliştirme verisine dokunmaz).
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const persist = join(root, '.wrangler', 'e2e')
const port = process.env.E2E_PORT ?? '8790'
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
const wrangler = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler')

rmSync(persist, { recursive: true, force: true })

const migrate = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'voyage', '--local', '--persist-to', persist],
  { cwd: root, env, stdio: 'inherit' })
if (migrate.status !== 0) process.exit(migrate.status ?? 1)

const dev = spawn(wrangler, [
  'dev', '--port', port, '--persist-to', persist,
  '--var', 'SESSION_SECRET:e2e-test-secret',
], { cwd: root, env, stdio: 'inherit' })

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => dev.kill(sig))
dev.on('exit', (code, signal) => process.exit(code ?? (signal ? 0 : 1)))
