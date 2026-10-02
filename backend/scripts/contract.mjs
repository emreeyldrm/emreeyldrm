// `npm run test:contract`: server/test altındaki NestJS e2e testlerini bu Worker'a karşı çalıştırır.
// start:e2e'yi arka planda başlatır, hazır olmasını bekler, jest'i API_URL ile çalıştırır, sunucuyu kapatır
// ve jest'in çıkış koduyla çıkar.
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.E2E_PORT ?? '8790'
const apiUrl = `http://localhost:${port}`
const logPath = join(root, '.wrangler', 'e2e-server.log')
const READY_TIMEOUT_MS = 120_000

mkdirSync(dirname(logPath), { recursive: true })
const log = createWriteStream(logPath)

async function up() {
  try { await fetch(`${apiUrl}/me`); return true } catch { return false }
}

if (await up()) {
  console.error(`Port ${port} zaten kullanımda; önce oradaki sunucuyu kapatın.`)
  process.exit(1)
}

// Kendi süreç grubunda başlat: kapatırken npm, node ve wrangler/workerd birlikte sonlansın.
const server = spawn('npm', ['run', 'start:e2e'], {
  cwd: root, env: { ...process.env, E2E_PORT: port }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.pipe(log)
server.stderr.pipe(log)
let serverExited = false
server.on('exit', () => { serverExited = true })

// Tüm süreç grubu (npm, node, wrangler, workerd) bitene kadar bekler; 10 sn sonra SIGKILL.
async function stopServer() {
  const kill = (sig) => { try { process.kill(-server.pid, sig); return true } catch { return false } }
  if (!kill('SIGTERM')) return
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (!kill(0)) return
  }
  kill('SIGKILL')
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stopServer(); process.exit(130) })

const started = Date.now()
while (!(await up())) {
  if (serverExited || Date.now() - started > READY_TIMEOUT_MS) {
    await stopServer()
    console.error(`Worker ${apiUrl} adresinde hazır olmadı. Günlük (${logPath}):\n`)
    console.error(readFileSync(logPath, 'utf8'))
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 500))
}
console.log(`Worker hazır: ${apiUrl} (günlük: ${logPath})`)

const jest = spawn('npx', ['jest', '--config', './test/jest-e2e.json', '--runInBand'], {
  cwd: join(root, '..', 'server'), env: { ...process.env, API_URL: apiUrl }, stdio: 'inherit',
})
const code = await new Promise((resolve) => jest.on('exit', (c) => resolve(c ?? 1)))
await stopServer()
process.exit(code)
