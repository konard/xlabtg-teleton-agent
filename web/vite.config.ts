import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '../dist/web')

function getBuildVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

// Vite plugin that writes build-meta.json into the output directory after build.
// This lets the backend /api/debug/ui-version endpoint report which build is served.
function buildMetaPlugin(): import('vite').Plugin {
  return {
    name: 'build-meta',
    closeBundle() {
      const version = getBuildVersion()
      const commit = getGitCommit()
      const buildTimestamp = new Date().toISOString()
      const meta = { version, commit, buildTimestamp }
      try {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(join(outDir, 'build-meta.json'), JSON.stringify(meta, null, 2))
      } catch {
        // non-fatal
      }
    },
  }
}

const buildVersion = getBuildVersion()
const buildCommit = getGitCommit()
const buildTimestamp = new Date().toISOString()

export default defineConfig({
  plugins: [react(), buildMetaPlugin()],
  define: {
    // Injected at build time so the UI footer can display the current version
    __BUILD_VERSION__: JSON.stringify(buildVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
})
