#!/usr/bin/env bun

import { watch } from 'fs'
import { spawn } from 'child_process'
import { resolve, join } from 'path'

const args = process.argv.slice(2)
const cwd = process.cwd()

// Separate our own flags from bun test args
const watchDirs = []
let bunTestArgs = []
let i = 0
while (i < args.length) {
  if (args[i] === '--watch-dir') {
    watchDirs.push(args[i + 1])
    i += 2
  } else {
    bunTestArgs.push(args[i])
    i++
  }
}

if (watchDirs.length === 0) watchDirs.push('.')

const JS_PATTERN = /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/

let proc = null
let debounceTimer = null
let restarting = false
let ready = false
setTimeout(() => { ready = true }, 500)

function main() {
  if (proc) {
    proc.kill()
    proc = null
  }
  restarting = false
  console.log(`\n[watch] running: bun test ${bunTestArgs.join(' ')}`)
  proc = spawn('bun', ['test', ...bunTestArgs], {
    cwd,
    stdio: 'inherit',
  })
  proc.on('exit', (code, signal) => {
    if (!restarting) {
      console.log(`\n[watch] test process exited (${signal ?? code}). waiting for changes...`)
    }
    proc = null
  })
}

function scheduleRestart(changedFile) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    console.log(`\n[watch] changed: ${changedFile}`)
    restarting = true
    main()
  }, 300)
}

const watchers = watchDirs.map((dir) => {
  const absDir = resolve(cwd, dir)
  return watch(absDir, { recursive: true }, (event, filename) => {
    if (!ready) return
    if (!filename) return
    if (!JS_PATTERN.test(filename)) return
    // ignore node_modules
    if (filename.includes('node_modules')) return
    scheduleRestart(join(absDir, filename))
  })
})

console.log(`[watch] watching ${watchDirs.join(', ')} for JS/TS changes`)
main()

process.on('SIGINT', () => {
  watchers.forEach((w) => w.close())
  if (proc) proc.kill()
  process.exit(0)
})
