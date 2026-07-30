#!/usr/bin/env node
/**
 * Scans the public demo repo for backend credentials, vendor SDKs, and
 * production brand strings that must not ship in a client-only build.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const scriptRel = relative(root, fileURLToPath(import.meta.url))

/** Banned substrings (case-insensitive). Kept as data so this file never matches itself via prose. */
const BANNED = [
  'supabase',
  '@supabase',
  'VITE_SUPABASE',
  'SUPABASE_ANON',
  '.supabase.co',
  'ybmrdsnqquryrdiqglng',
  'anthropic',
  'ANTHROPIC_API_KEY',
  'claude-haiku',
  'x-api-key',
  'sentry',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_DSN',
  'ingest.sentry.io',
  'madebyangela',
  '"made by angela"',
  'bubu-tracker',
  'bubu-crm',
  'netlify/functions',
]

const SCAN_ROOTS = ['src', 'e2e', 'test', 'scripts', 'public', 'index.html', 'dist']
const ROOT_CONFIG_NAMES = [
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'vercel.json',
  'playwright.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  '.oxlintrc.json',
  '.gitignore',
  'README.md',
  'netlify.toml',
]

const SKIP_DIR_NAMES = new Set(['node_modules', '.git'])

/** @type {{ file: string, line: number, token: string }[]} */
const hits = []
let filesScanned = 0

function shouldSkipDir(name) {
  return SKIP_DIR_NAMES.has(name)
}

function collectFiles(entryPath, out) {
  if (!existsSync(entryPath)) return
  const st = statSync(entryPath)
  if (st.isFile()) {
    out.push(entryPath)
    return
  }
  if (!st.isDirectory()) return
  for (const name of readdirSync(entryPath)) {
    if (shouldSkipDir(name)) continue
    collectFiles(join(entryPath, name), out)
  }
}

function scanFile(absPath) {
  const rel = relative(root, absPath)
  if (rel === scriptRel || rel.replaceAll('\\', '/') === scriptRel.replaceAll('\\', '/')) return

  let text
  try {
    text = readFileSync(absPath, 'utf8')
  } catch {
    return
  }

  filesScanned += 1
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase()
    for (const token of BANNED) {
      if (lower.includes(token.toLowerCase())) {
        hits.push({ file: rel.replaceAll('\\', '/'), line: i + 1, token })
      }
    }
  }
}

function findEnvFiles(dir, out) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (shouldSkipDir(name)) continue
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) findEnvFiles(abs, out)
    else if (name === '.env' || name.startsWith('.env.')) out.push(relative(root, abs).replaceAll('\\', '/'))
  }
}

function checkPackageDeps() {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[section]
    if (!deps || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@supabase/') || name.startsWith('@sentry/')) {
        hits.push({ file: 'package.json', line: 0, token: name })
      }
    }
  }
}

function main() {
  /** @type {string[]} */
  const files = []

  for (const entry of SCAN_ROOTS) {
    collectFiles(join(root, entry), files)
  }
  for (const name of ROOT_CONFIG_NAMES) {
    const abs = join(root, name)
    if (existsSync(abs) && statSync(abs).isFile()) files.push(abs)
  }

  // Also scan workflow files under .github if present
  collectFiles(join(root, '.github'), files)

  const unique = [...new Set(files)]
  for (const file of unique) scanFile(file)

  const envFiles = []
  findEnvFiles(root, envFiles)
  for (const env of envFiles) {
    hits.push({ file: env, line: 0, token: '.env*' })
  }

  checkPackageDeps()

  if (hits.length > 0) {
    console.error('Public-safety check FAILED\n')
    for (const hit of hits) {
      const loc = hit.line > 0 ? `${hit.file}:${hit.line}` : hit.file
      console.error(`  ${loc}  →  ${hit.token}`)
    }
    console.error(`\n${hits.length} hit(s) in ${filesScanned} file(s) scanned.`)
    process.exit(1)
  }

  console.log(`Public-safety check OK — ${filesScanned} files scanned, no banned tokens.`)
  process.exit(0)
}

main()
