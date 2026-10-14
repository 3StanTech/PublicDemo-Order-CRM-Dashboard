#!/usr/bin/env node
/**
 * Post-build bundle budget check.
 *
 * Measures gzipped transfer size of the initial `/today` route: entry + static
 * graph + framework + today route chunk + the startup chunks loaded right after
 * unlock (the Firestore adapter chunk that src/data/adapter.ts imports
 * dynamically, and its static graph). Other lazy route chunks are excluded.
 *
 * Budget is KiB of gzipped JS. Fail with non-zero exit if exceeded.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distDir = join(root, 'dist')
const assetsDir = join(distDir, 'assets')

/**
 * @type {number} Budget in KiB (gzipped initial-route transfer, startup chunks
 * included). Measured 286.69 KiB on 2026-10-14; the budget adds small headroom.
 */
const BUDGET_KIB = 300

const KiB = 1024

function formatBytes(n) {
  return `${(n / KiB).toFixed(2)} KiB`
}

function gzipSize(buf) {
  return gzipSync(buf).length
}

function listJsAssets() {
  if (!existsSync(assetsDir)) {
    console.error(`check-bundle: missing ${assetsDir} — run production build first`)
    process.exit(1)
  }
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js') && !name.includes('workbox'))
    .map((name) => {
      const path = join(assetsDir, name)
      const buf = readFileSync(path)
      return {
        name,
        path,
        raw: buf.length,
        gzip: gzipSize(buf),
        content: buf.toString('utf8'),
      }
    })
    .sort((a, b) => b.gzip - a.gzip)
}

/** Static ESM import/export-from specifiers only (not dynamic import()). */
function staticImportSpecifiers(source) {
  // Vite/rolldown minify to: import{x as y}from"./chunk.js" (no spaces)
  const stripped = source.replace(/\bimport\s*\(\s*["'`][^"'`]+["'`]\s*\)/g, '/*dynamic*/')
  const specs = new Set()
  let m
  // import ... from "..."  /  export ... from "..."
  const fromRe = /\b(?:import|export)\b[^"'`]*?\bfrom\s*["']([^"']+)["']/g
  while ((m = fromRe.exec(stripped)) !== null) {
    specs.add(m[1])
  }
  // Side-effect: import "x"
  const sideEffect = /\bimport\s*["']([^"']+)["']/g
  while ((m = sideEffect.exec(stripped)) !== null) {
    specs.add(m[1])
  }
  return [...specs]
}

function dynamicImportSpecifiers(source) {
  const specs = []
  const re = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  let m
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1])
  }
  return specs
}

function resolveAssetName(specifier, byName) {
  const base = basename(specifier).split('?')[0]
  if (byName.has(base)) return base
  for (const name of byName.keys()) {
    if (name === base || specifier.endsWith(name) || specifier.endsWith('./' + name)) {
      return name
    }
  }
  return null
}

function parseIndexEntryScripts() {
  const htmlPath = join(distDir, 'index.html')
  if (!existsSync(htmlPath)) {
    console.error('check-bundle: missing dist/index.html')
    process.exit(1)
  }
  const html = readFileSync(htmlPath, 'utf8')
  const scripts = []
  const re = /<script[^>]+src=["']([^"']+)["'][^>]*>/g
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[1].endsWith('.js')) scripts.push(basename(m[1]))
  }
  const preloadRe = /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["'][^>]*>/gi
  while ((m = preloadRe.exec(html)) !== null) {
    if (m[1].endsWith('.js')) scripts.push(basename(m[1]))
  }
  const preloadRe2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']modulepreload["'][^>]*>/gi
  while ((m = preloadRe2.exec(html)) !== null) {
    if (m[1].endsWith('.js')) scripts.push(basename(m[1]))
  }
  return [...new Set(scripts)]
}

function isOtherRouteChunk(name) {
  return /(?:ImportPage|OrdersPage|CustomersPage|InsightsPage|SettingsPage)-/.test(name)
}

function isTodayRouteChunk(name) {
  return /TodayPage-/.test(name)
}

/** Dynamic chunks the app loads at startup, right after unlock (not route-lazy). */
function isStartupChunk(name) {
  return /^firestore-adapter-/.test(name)
}

function walkStaticGraph(startNames, byName, { excludeOtherRoutes = true } = {}) {
  const out = new Set()
  const queue = [...startNames]
  while (queue.length > 0) {
    const name = queue.pop()
    if (!name || out.has(name)) continue
    if (excludeOtherRoutes && isOtherRouteChunk(name)) continue
    out.add(name)
    const asset = byName.get(name)
    if (!asset) continue
    for (const spec of staticImportSpecifiers(asset.content)) {
      const resolved = resolveAssetName(spec, byName)
      if (resolved && !out.has(resolved)) queue.push(resolved)
    }
  }
  return out
}

function collectInitialGraph(assets) {
  const byName = new Map(assets.map((a) => [a.name, a]))
  const entryNames = parseIndexEntryScripts().filter((n) => byName.has(n))

  if (entryNames.length === 0) {
    const guess = assets.find((a) => /^index-/.test(a.name))
    if (guess) entryNames.push(guess.name)
  }

  if (entryNames.length === 0) {
    console.error('check-bundle: could not identify entry chunk from index.html')
    process.exit(1)
  }

  // Entry + static import graph (includes framework when entry imports it)
  const initial = walkStaticGraph(entryNames, byName)

  // Ensure named vendor chunks are counted when present
  for (const a of assets) {
    if (/^framework-/.test(a.name)) {
      for (const n of walkStaticGraph([a.name], byName)) initial.add(n)
    }
  }

  // /today route chunk and startup chunks via name or dynamic import from the initial set
  const dynamicNames = assets.filter((a) => isTodayRouteChunk(a.name) || isStartupChunk(a.name)).map((a) => a.name)
  for (const name of [...initial]) {
    const asset = byName.get(name)
    if (!asset) continue
    for (const spec of dynamicImportSpecifiers(asset.content)) {
      const resolved = resolveAssetName(spec, byName)
      if (resolved && (isTodayRouteChunk(resolved) || isStartupChunk(resolved))) dynamicNames.push(resolved)
    }
  }

  for (const n of walkStaticGraph([...new Set(dynamicNames)], byName)) {
    initial.add(n)
  }

  // Never count the other five lazy routes
  for (const name of [...initial]) {
    if (isOtherRouteChunk(name)) initial.delete(name)
  }

  return { initial, entryNames }
}

function pad(s, n) {
  const str = String(s)
  return str.length >= n ? str.slice(0, n - 1) + ' ' : str + ' '.repeat(n - str.length)
}

function main() {
  const assets = listJsAssets()
  if (assets.length === 0) {
    console.error('check-bundle: no JS assets in dist/assets')
    process.exit(1)
  }

  const { initial, entryNames } = collectInitialGraph(assets)

  console.log('Bundle size report (uncompressed / gzipped)\n')
  console.log(pad('Asset', 48) + pad('Raw', 14) + pad('Gzip', 14) + 'Initial?')
  console.log('-'.repeat(90))

  let initialGzip = 0
  let initialRaw = 0

  for (const a of assets) {
    const inInitial = initial.has(a.name)
    if (inInitial) {
      initialGzip += a.gzip
      initialRaw += a.raw
    }
    console.log(
      pad(a.name, 48) +
        pad(formatBytes(a.raw), 14) +
        pad(formatBytes(a.gzip), 14) +
        (inInitial ? 'yes' : 'no'),
    )
  }

  console.log('-'.repeat(90))
  console.log(`Entry scripts (from index.html): ${entryNames.join(', ') || '(none)'}`)
  console.log(
    `Initial /today transfer incl. startup Firestore adapter chunk: ${formatBytes(initialRaw)} raw, ${formatBytes(initialGzip)} gzipped ` +
      `(${[...initial].sort().join(', ')})`,
  )

  const budgetBytes = BUDGET_KIB * KiB
  console.log(`Budget: ${BUDGET_KIB} KiB gzipped`)

  if (initialGzip > budgetBytes) {
    console.error(
      `\nFAIL: initial-route gzipped transfer (incl. startup Firestore adapter chunk) ${formatBytes(initialGzip)} exceeds budget ${BUDGET_KIB} KiB ` +
        `(${formatBytes(budgetBytes)})`,
    )
    process.exit(1)
  }

  console.log(
    `\nOK: initial-route gzipped transfer (incl. startup Firestore adapter chunk) ${formatBytes(initialGzip)} within ${BUDGET_KIB} KiB budget`,
  )
  process.exit(0)
}

main()
