/**
 * rdbljs v1 — single-file reference implementation
 *
 * Philosophy:
 * - DOM-first (HTML is structure)
 * - plain attributes (text/show/class/attr/model/each/key + native on*)
 * - NO expressions in bindings
 * - on* attributes are action-path only (Model A)
 * - signals + computed + effects
 * - keyed list diffing
 * - DOM-scoped Context (no prop drilling)
 * - clean disposal
 *
 * Evolutions included:
 * 1) MutationObserver auto-bind (opt-in)
 * 2) Microtask batching for effects
 * 3) Dev warnings (missing paths/actions, invalid usage)
 * 4) Scoped sub-bind: bind(el, subScope) and createScope(parent, patch)
 */

// ─────────────────────────────────────────────────────────────
// Reactive core: signal / computed / effect / batch
// ─────────────────────────────────────────────────────────────
let CURRENT_EFFECT = null
let BATCH_DEPTH = 0
let FLUSH_SCHEDULED = false
const QUEUE = new Set()

function schedule(runner) {
  QUEUE.add(runner)
  if (BATCH_DEPTH > 0) return
  if (FLUSH_SCHEDULED) return
  FLUSH_SCHEDULED = true
  queueMicrotask(flush)
}

function flush() {
  FLUSH_SCHEDULED = false
  while (QUEUE.size) {
    const toRun = Array.from(QUEUE)
    QUEUE.clear()
    for (const fn of toRun) fn()
  }
}

export function batch(fn) {
  BATCH_DEPTH++
  try { return fn() }
  finally {
    BATCH_DEPTH--
    if (BATCH_DEPTH === 0) flush()
  }
}

export function signal(initial) {
  let value = initial
  const subs = new Set()

  function read() {
    if (CURRENT_EFFECT) {
      subs.add(CURRENT_EFFECT)
      CURRENT_EFFECT._touched.add(subs)
    }
    return value
  }

  read.set = (next) => {
    if (Object.is(value, next)) return
    value = next
    subs.forEach(schedule)
  }

  read.peek = () => value
  return read
}

export function effect(fn) {
  let cleanup
  const runner = () => {
    // unsubscribe from prior dependencies
    runner._touched.forEach(s => s.delete(runner))
    runner._touched.clear()
    if (typeof cleanup === 'function') {
      cleanup()
      cleanup = undefined
    }

    const prev = CURRENT_EFFECT
    CURRENT_EFFECT = runner
    try {
      const nextCleanup = fn()
      cleanup = typeof nextCleanup === 'function' ? nextCleanup : undefined
    } finally { CURRENT_EFFECT = prev }
  }
  runner._touched = new Set()
  runner()
  return () => {
    runner._touched.forEach(s => s.delete(runner))
    runner._touched.clear()
    if (typeof cleanup === 'function') {
      cleanup()
      cleanup = undefined
    }
  }
}

export function computed(fn) {
  let cached
  let dirty = true
  const subs = new Set()

  const invalidator = () => {
    dirty = true
    subs.forEach(schedule)
  }
  invalidator._touched = new Set()

  function read() {
    if (CURRENT_EFFECT) {
      subs.add(CURRENT_EFFECT)
      CURRENT_EFFECT._touched.add(subs)
    }
    if (!dirty) return cached

    // unsubscribe invalidator from old deps
    invalidator._touched.forEach(s => s.delete(invalidator))
    invalidator._touched.clear()

    const prev = CURRENT_EFFECT
    CURRENT_EFFECT = invalidator
    try { cached = fn() }
    finally { CURRENT_EFFECT = prev }

    dirty = false
    return cached
  }

  read.peek = () => (dirty ? fn() : cached)
  return read
}

// ─────────────────────────────────────────────────────────────
// Context (DOM-scoped) — no prop drilling
// ─────────────────────────────────────────────────────────────
export class Context {
  static #map = new WeakMap()

  static provide(rootEl, ctx) {
    if (!(rootEl instanceof Element)) throw new TypeError('Context.provide: rootEl must be an Element')
    this.#map.set(rootEl, ctx)
    return ctx
  }

  static read(fromEl) {
    for (let cur = fromEl; cur; cur = cur.parentElement) {
      const ctx = this.#map.get(cur)
      if (ctx) return ctx
    }
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// Dev helpers
// ─────────────────────────────────────────────────────────────
function warn(dev, ...args) { if (dev) console.warn('[rdbljs]', ...args) }

function truncate(text, max = 180) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

function compactHtmlSnippet(el) {
  if (!(el instanceof Element)) return ''
  const source = el.outerHTML || `<${el.tagName.toLowerCase()}>`
  return truncate(source.replace(/\s+/g, ' ').trim(), 180)
}

function safeJson(value) {
  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (key, current) => {
      if (typeof current === 'function') return '[Function]'
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]'
        seen.add(current)
      }
      return current
    })
  } catch {
    return '[Unserializable]'
  }
}

function bindingDebugContext(el) {
  if (!(el instanceof Element)) return ''
  const itemCtx = getItemContext(el)
  const parts = []
  const island = el.closest?.('[island]')?.getAttribute?.('island')
    || itemCtx?.host?.closest?.('[island]')?.getAttribute?.('island')
    || itemCtx?.host?.getAttribute?.('island')
  if (island) parts.push(`island="${island}"`)
  const node = compactHtmlSnippet(el)
  if (node) parts.push(`node=${node}`)
  if (itemCtx && Object.prototype.hasOwnProperty.call(itemCtx, 'item')) {
    parts.push(`item=${safeJson(itemCtx.item)}`)
  }
  return parts.length ? ` (${parts.join(' ')})` : ''
}

function isSignal(v) {
  return typeof v === 'function' && typeof v.set === 'function'
}

function isReadable(v) {
  return typeof v === 'function' && (typeof v.set === 'function' || typeof v.peek === 'function')
}

// Returns true when an element is SSR-rendered content that should not be
// stomped on the first effect run. Triggered by either:
//   data-ssr  — explicit opt-in
//   data-key  — the element is (or is inside) a keyed SSR row in a list
function isSSRPreserved(el) {
  return el.hasAttribute('data-ssr') || el.hasAttribute('data-key') || !!el.closest('[data-key]')
}

function resolve(obj, path) {
  const parts = String(path).split('.').map(s => s.trim()).filter(Boolean)
  let cur = obj
  for (const p of parts) cur = cur?.[p]
  return cur
}

function readValue(scope, path) {
  const v = resolve(scope, path)
  return isReadable(v) ? v() : v
}

function readBoundValue(scope, path, el) {
  return readValue(getBoundScope(el) ?? scope, path)
}

function setModelValue(el, v) {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') el.checked = !!v
    else el.value = v ?? ''
    return
  }
  if (el instanceof HTMLTextAreaElement) { el.value = v ?? ''; return }
  if (el instanceof HTMLSelectElement) { el.value = v ?? ''; return }
}

function getModelValue(el) {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked
    return el.value
  }
  if (el instanceof HTMLTextAreaElement) return el.value
  if (el instanceof HTMLSelectElement) return el.value
  return undefined
}

// Item context (list rows) — uses WeakMap to avoid expando fields if desired
const ITEM_CTX = new WeakMap()
function setItemContext(node, ctx) { ITEM_CTX.set(node, ctx) }
export function getItemContext(fromEl) {
  for (let cur = fromEl; cur; cur = cur.parentElement) {
    const ctx = ITEM_CTX.get(cur)
    if (ctx) return ctx
  }
  return null
}

const BOUND_SCOPE = new WeakMap()
function setBoundScope(node, scope) { BOUND_SCOPE.set(node, scope) }
function getBoundScope(fromEl) {
  for (let cur = fromEl; cur; cur = cur.parentElement) {
    const scope = BOUND_SCOPE.get(cur)
    if (scope) return scope
  }
  return null
}

// Scoped sub-bind helper: create a scope that falls back to parent
export function createScope(parent, patch) {
  return new Proxy(patch, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return parent[prop]
    },
    has(target, prop) {
      return (prop in target) || (prop in parent)
    }
  })
}

// ─────────────────────────────────────────────────────────────
// Binder internals
// ─────────────────────────────────────────────────────────────
const DEFAULTS = {
  dev: true,
  autoBind: false,           // MutationObserver auto-bind
  observeRoot: false,        // if true, observes root itself too (rarely needed)
  ignoreSelector: '[data-no-bind]', // subtree opt-out marker
}

function shouldIgnore(el, ignoreSelector) {
  if (!(el instanceof Element)) return true
  if (el.closest && el.closest('template')) return true
  return !!(ignoreSelector && el.closest && el.closest(ignoreSelector))
}

function isManagedByEach(el) {
  const eachHost = el?.closest?.('[each]')
  return !!(eachHost && !el.hasAttribute('each'))
}

function collectRootsForAutoBind(node, ignoreSelector) {
  const roots = []
  if (!(node instanceof Element)) return roots
  if (!shouldIgnore(node, ignoreSelector)) roots.push(node)
  node.querySelectorAll?.(':scope *')?.forEach?.(() => {}) // noop; avoid older engines? (safe)
  return roots
}

// Return list of "binding elements" under root, including root
function allElements(root) {
  const els = []
  function walk(node) {
    if (!(node instanceof Element)) return
    els.push(node)
    // enable nested islands.
    if (node !== root && node.hasAttribute('island')) return
    for (const child of Array.from(node.children || [])) {
      walk(child)
    }
  }
  walk(root)
  return els
}

function parseAttrSpec(spec) {
  // "name:path; name2:path2"
  return String(spec)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => pair.split(':').map(x => x.trim()))
    .filter(([a,b]) => a && b)
}

function isDialogElement(el) {
  return (typeof HTMLDialogElement !== 'undefined' && el instanceof HTMLDialogElement)
    || el?.tagName === 'DIALOG'
}

function setDialogShown(el, shown) {
  if (shown) {
    el.hidden = false
    if (!el.hasAttribute('open')) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
    return
  }

  if (el.hasAttribute('open')) {
    if (typeof el.close === 'function') el.close()
    else el.removeAttribute('open')
  }
  el.hidden = true
}

// ─────────────────────────────────────────────────────────────
// bind(root, scope, options)
// ─────────────────────────────────────────────────────────────
export function bind(root, scope, options = {}) {
  if (!root || root.nodeType !== 1) throw new TypeError('bind: root must be an Element')
  const opt = { ...DEFAULTS, ...options }
  const disposers = []
  const boundRoots = new WeakSet() // prevent double-binding in auto-bind mode

  const getCtx = (el) => Context.read(el)

  function bindRootOnce(r) {
    if (!(r instanceof Element)) return
    if (boundRoots.has(r)) return
    if (shouldIgnore(r, opt.ignoreSelector)) return

    boundRoots.add(r)

    // Order matters slightly: lists create subtrees, but we keep it simple:
    // - bindEach first so it renders children, then bind the rest for that root
    disposers.push(bindEach(r, scope, opt, { getCtx, bindSubtree }))
    disposers.push(bindText(r, scope, opt))
    disposers.push(bindHtml(r, scope, opt))
    disposers.push(bindShow(r, scope, opt))
    disposers.push(bindClass(r, scope, opt))
    disposers.push(bindAttr(r, scope, opt))
    disposers.push(bindModel(r, scope, opt))
    disposers.push(bindEvents(r, scope, opt, { getCtx }))
  }

  function bindSubtree(subRoot, subScope = scope) {
    // Scoped sub-bind: same binder but with different scope
    // Note: not wired into autoBind automatically unless you call it
    return bind(subRoot, subScope, { ...opt, autoBind: false })
  }

  // Initial bind
  bindRootOnce(root)

  // MutationObserver auto-bind (opt-in)
  let observerDispose = null
  if (opt.autoBind) {
    const obsRoot = opt.observeRoot ? root : root
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue
          if (shouldIgnore(n, opt.ignoreSelector)) continue
          // Bind the added subtree root once (binder scans its descendants)
          bindRootOnce(n)
        }
      }
    })
    mo.observe(obsRoot, { childList: true, subtree: true })
    observerDispose = () => mo.disconnect()
  }

  return {
    bindSubtree,
    dispose() {
      if (observerDispose) observerDispose()
      // dispose in reverse (best-effort)
      for (let i = disposers.length - 1; i >= 0; i--) {
        try { disposers[i]?.dispose?.() } catch {}
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Individual directive binders
// ─────────────────────────────────────────────────────────────
function bindText(root, scope, opt) {
  const stops = []
  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue
    if (!el.hasAttribute('text')) continue
    const path = el.getAttribute('text')
    let skipFirst = isSSRPreserved(el) || el.textContent.trim() !== ''

    const stop = effect(() => {
      const v = readValue(scope, path)
      const value = readBoundValue(scope, path, el)
      if (value === undefined) warn(opt.dev, `text="${path}" resolved to undefined${bindingDebugContext(el)}`)
      if (skipFirst) { skipFirst = false; return }
      el.textContent = value ?? ''
    })
    stops.push(stop)
  }
  return { dispose: () => stops.forEach(s => s()) }
}

function bindHtml(root, scope, opt) {
  const stops = []
  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue
    if (!el.hasAttribute('html')) continue
    const path = el.getAttribute('html')
    let skipFirst = isSSRPreserved(el) || el.innerHTML.trim() !== ''

    const stop = effect(() => {
      const v = readBoundValue(scope, path, el)
      if (skipFirst) { skipFirst = false; return }
      el.innerHTML = v ?? ''
    })
    stops.push(stop)
  }
  return { dispose: () => stops.forEach(s => s()) }
}

function bindShow(root, scope, opt) {
  const stops = []
  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue
    if (!el.hasAttribute('show')) continue
    const path = el.getAttribute('show')

    let skipFirst = isSSRPreserved(el)
    const stop = effect(() => {
      const v = !!readBoundValue(scope, path, el)
      if (skipFirst) { skipFirst = false; return }
      if (isDialogElement(el)) {
        setDialogShown(el, v)
        return
      }
      el.hidden = !v
    })
    stops.push(stop)
  }
  return { dispose: () => stops.forEach(s => s()) }
}

function bindClass(root, scope, opt) {
  const stops = []
  // NOTE: this collides with native class attr.
  // If you want to keep native class= for static classnames,
  // prefer `cls="path"` instead. For v1, we support `cls`.
  // We'll honor `cls` and ignore `class` unless it's `cls`.
  // Prefer `cls`:
  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue
    if (!el.hasAttribute('cls')) continue
    const path = el.getAttribute('cls')
    let skipFirst = isSSRPreserved(el)
    const stop = effect(() => {
      const v = readBoundValue(scope, path, el)
      if (skipFirst) { skipFirst = false; return }
      if (typeof v === 'string') {
        el.className = v
      } else if (v && typeof v === 'object') {
        for (const [cls, on] of Object.entries(v)) el.classList.toggle(cls, !!on)
      } else if (v == null) {
        // no-op
      } else {
        warn(opt.dev, `cls="${path}" should be string or object`, el)
      }
    })
    stops.push(stop)
  }
  return { dispose: () => stops.forEach(s => s()) }
}

function bindAttr(root, scope, opt) {
  const stops = []
  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue
    if (!el.hasAttribute('attr')) continue
    const spec = el.getAttribute('attr')
    const pairs = parseAttrSpec(spec)
    let skipFirst = isSSRPreserved(el)
    const stop = effect(() => {
      const values = pairs.map(([name, path]) => [name, readBoundValue(scope, path, el)])
      if (skipFirst) { skipFirst = false; return }
      for (const [name, v] of values) {
        if (v === false || v == null) el.removeAttribute(name)
        else el.setAttribute(name, String(v))
      }
    })
    stops.push(stop)
  }
  return { dispose: () => stops.forEach(s => s()) }
}

function bindModel(root, scope, opt) {
  const stops = []
  const offs = []

  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue
    if (!el.hasAttribute('model')) continue

    const path = el.getAttribute('model')
    const sig = resolve(scope, path)

    if (!isSignal(sig)) {
      warn(opt.dev, `model="${path}" must resolve to a signal`, el)
      continue
    }

    // UI -> state
    const evt =
      (el instanceof HTMLSelectElement) ? 'change'
      : (el instanceof HTMLInputElement && el.type === 'checkbox') ? 'change'
      : 'input'

    const handler = () => sig.set(getModelValue(el))
    el.addEventListener(evt, handler)
    offs.push(() => el.removeEventListener(evt, handler))

    // state -> UI
    let skipFirst = isSSRPreserved(el)
    const stop = effect(() => {
      const v = sig()
      if (skipFirst) { skipFirst = false; return }
      setModelValue(el, v)
    })
    stops.push(stop)
  }

  return {
    dispose() {
      stops.forEach(s => s())
      offs.forEach(off => off())
    }
  }
}

function bindEvents(root, scope, opt, { getCtx }) {
  const offs = []

  // Walk all elements (including root). For each attribute starting with "on"
  for (const el of allElements(root)) {
    if (shouldIgnore(el, opt.ignoreSelector)) continue
    if (isManagedByEach(el)) continue

    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('on')) continue

      const eventName = attr.name.slice(2) // onclick -> click
      const actionPath = attr.value.trim()

      // Disable native inline handler evaluation
      try { el[attr.name] = null } catch {}
      el.removeAttribute(attr.name)

      const handler = (event) => {
        const fn = resolve(scope, actionPath)
        if (typeof fn !== 'function') {
          warn(opt.dev, `on${eventName}="${actionPath}" did not resolve to a function`, el)
          return
        }
        const ctx = getCtx(el)
        const res = fn.call(scope, event, el, ctx)
        if (res === false) {
          event.preventDefault()
          event.stopPropagation()
        }
      }

      el.addEventListener(eventName, handler)
      offs.push(() => el.removeEventListener(eventName, handler))
    }
  }

  return { dispose: () => offs.forEach(off => off()) }
}

// ─────────────────────────────────────────────────────────────
// each + key (keyed list diffing)
// Notes:
// - each="path" must resolve to array (signal or plain)
// - key="idPath" resolved on item (path-only, default: "id")
// - template required
// - item scope provides item props + $item/$index (via proxy)
// - bindSubtree is used to bind item content without rebinding the whole document
// ─────────────────────────────────────────────────────────────

// Group direct-child siblings of host by data-key attribute. The element
// carrying data-key starts a new group; subsequent siblings without data-key
// belong to the same group until the next data-key element or the template.
function collectDataKeyGroups(host, tpl) {
  const groups = []
  let current = null
  for (const child of Array.from(host.children)) {
    if (child === tpl || child.tagName === 'TEMPLATE') break
    if (child.hasAttribute('data-key')) {
      if (current) groups.push(current)
      current = { key: child.getAttribute('data-key'), nodes: [child] }
    } else if (current) {
      current.nodes.push(child)
    }
  }
  if (current) groups.push(current)
  return groups
}

function bindEach(root, scope, opt, { getCtx, bindSubtree }) {
  const stops = []
  const listDisposers = []
  // Track each hosts we've set up so the allElements scan doesn't double-bind
  // inner each hosts that hydrateEntry already bound via bindSubtree.
  const processedEachHosts = new Set()

  for (const host of allElements(root)) {
    if (shouldIgnore(host, opt.ignoreSelector)) continue
    if (!host.hasAttribute('each')) continue
    // Skip hosts removed from the DOM by a preceding effect (legacy data-ssr path).
    if (!root.contains(host)) continue
    // Skip inner each hosts already bound by a hydrateEntry → bindSubtree call.
    if ([...processedEachHosts].some(p => p.contains(host))) continue

    const listPath = host.getAttribute('each')
    const keyPath = host.getAttribute('key') || 'id'
    // Use direct-child template only — querySelector would find a <template>
    // inside a data-key row before the host's own template.
    const tpl = Array.from(host.children).find(el => el.tagName === 'TEMPLATE')

    // Detect SSR-rendered rows by data-key on direct children.
    // Must happen before DOM manipulation so we can see the original children.
    const ssrGroups = collectDataKeyGroups(host, tpl)

    if (!tpl && ssrGroups.length === 0) {
      warn(opt.dev, `each="${listPath}" requires a <template> child`, host)
      continue
    }
    if (!tpl) {
      warn(opt.dev, `each="${listPath}" has no <template> — existing rows will be reactive but new items cannot be added`, host)
    }

    processedEachHosts.add(host)

    // Prepare host
    const marker = document.createComment(`each:${listPath}`)
    if (ssrGroups.length > 0) {
      // Hydration mode: preserve existing rows, insert marker before them.
      // The live Map will be pre-populated from these rows below.
      host.insertBefore(marker, host.firstChild)
      if (tpl) host.appendChild(tpl)
    } else {
      host.innerHTML = ''
      host.append(marker, tpl)
    }

    let live = new Map() // key -> entry

    function itemKey(item) {
      return resolve(item, keyPath)
    }

    // Shared entry construction. tmp must already contain the item's nodes.
    // For createEntry tmp holds cloned template content; for hydrateEntry it
    // holds the SSR nodes temporarily so bindSubtree can scan them.
    function makeEntry(tmp, item, index) {
      let currentItem = item
      const itemScope = createScope(scope, { $item: item, $index: index })
      const proxyScope = new Proxy(itemScope, {
        get(target, prop) {
          if (prop in target) return target[prop]
          if (currentItem && typeof currentItem === 'object' && prop in currentItem) return currentItem[prop]
          return scope[prop]
        },
        has(target, prop) {
          return (prop in target) || (currentItem && typeof currentItem === 'object' && prop in currentItem) || (prop in scope)
        }
      })

      const nodes = Array.from(tmp.childNodes)

      function attachItemContextTree(node, ctx) {
        if (!(node instanceof Element)) return
        setItemContext(node, ctx)
        for (const child of Array.from(node.children || [])) attachItemContextTree(child, ctx)
      }
      function attachBoundScopeTree(node, scopeForNode) {
        if (!(node instanceof Element)) return
        setBoundScope(node, scopeForNode)
        for (const child of Array.from(node.children || [])) attachBoundScopeTree(child, scopeForNode)
      }

      const initialCtx = { item, index, key: itemKey(item), host }
      for (const n of nodes) {
        attachItemContextTree(n, initialCtx)
        attachBoundScopeTree(n, proxyScope)
      }

      const binding = bindSubtree(tmp, proxyScope)

      return {
        nodes,
        binding,
        item,
        index,
        setItem(nextItem, nextIndex, key) {
          currentItem = nextItem
          this.item = nextItem
          this.index = nextIndex
          for (const n of this.nodes) {
            if (n instanceof Element) setItemContext(n, { item: nextItem, index: nextIndex, key, host })
          }
        }
      }
    }

    function createEntry(item, index) {
      const tmp = document.createElement('div')
      tmp.appendChild(tpl.content.cloneNode(true))
      return makeEntry(tmp, item, index)
    }

    // Bind existing SSR nodes in-place by temporarily moving them into a
    // container (same trick createEntry uses with cloned template content).
    function hydrateEntry(nodes, item, index) {
      const tmp = document.createElement('div')
      const parent = nodes[0].parentNode
      const after = nodes[nodes.length - 1].nextSibling
      nodes.forEach(n => tmp.appendChild(n))
      const entry = makeEntry(tmp, item, index)
      nodes.forEach(n => parent.insertBefore(n, after))
      return entry
    }

    // Pre-populate live from SSR-rendered data-key rows so the first effect
    // run is a diff against already-hydrated entries (no DOM replacement).
    if (ssrGroups.length > 0) {
      const currentItems = readValue(scope, listPath) || []
      if (Array.isArray(currentItems)) {
        for (const group of ssrGroups) {
          const item = currentItems.find(i => String(itemKey(i)) === group.key)
          if (!item) continue
          const entry = hydrateEntry(group.nodes, item, currentItems.indexOf(item))
          live.set(itemKey(item), entry)
        }
      }
    }

    const stop = effect(() => {
      const items = readValue(scope, listPath) || []
      if (!Array.isArray(items)) {
        warn(opt.dev, `each="${listPath}" did not resolve to an array`, host)
        return
      }

      const next = new Map()

      // Create/reuse
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const k = itemKey(item)
        if (k == null) {
          warn(opt.dev, `each="${listPath}" item missing key "${keyPath}"`, item, host)
          continue
        }

        let entry = live.get(k)
        if (!entry) {
          if (!tpl) {
            warn(opt.dev, `each="${listPath}" cannot render new item — no <template> child`, host)
            continue
          }
          entry = createEntry(item, i)
        } else {
          // If keyed item identity changed, recreate subtree bindings so
          // non-reactive plain item fields are read from the new object.
          if (entry.item !== item) {
            if (tpl) {
              try { entry.binding?.dispose?.() } catch {}
              for (const n of entry.nodes) n.remove()
              entry = createEntry(item, i)
            } else {
              // No template — can't recreate, but update item reference so
              // signal-based fields still track the new object.
              entry.setItem(item, i, k)
            }
          } else {
            entry.setItem(item, i, k)
          }
        }
        next.set(k, entry)
      }

      // Reorder DOM
      const frag = document.createDocumentFragment()
      for (const entry of next.values()) {
        for (const n of entry.nodes) frag.appendChild(n)
      }

      // Clear rendered nodes between marker and template (or end of host if no template)
      while (marker.nextSibling && marker.nextSibling !== tpl) marker.nextSibling.remove()

      host.insertBefore(frag, tpl ?? null)

      // Dispose removed
      for (const [k, entry] of live.entries()) {
        if (!next.has(k)) {
          try { entry.binding?.dispose?.() } catch {}
          for (const n of entry.nodes) n.remove()
        }
      }

      live = next
    })

    stops.push(stop)
    listDisposers.push(() => {
      stop()
      for (const entry of live.values()) {
        try { entry.binding?.dispose?.() } catch {}
        for (const n of entry.nodes) n.remove()
      }
      live.clear()
    })
  }

  return {
    dispose() {
      stops.forEach(s => s())
      listDisposers.forEach(d => d())
    }
  }
}

export async function init(window, roots) {
  if (!roots) {
    roots = [...document.querySelectorAll('[island]')]
  }
  
  const instances = {}
  let i = 0

  for await (const root of roots) {
    const key = root.getAttribute('island')
    try {
      const scopeFactory = (await import(key)).default
      const scope = scopeFactory(root, window)
      instances[`${key}:${i++}`] = bind(root, scope, { dev: true })
    } catch (err) {
      console.error(`Failed to load island "${key}":`, err)
    }
  }
  return instances
}

/* ─────────────────────────────────────────────────────────────
Usage sketch:

import { bind, signal, computed, Context, getItemContext } from './rdbl.js'

const root = document.querySelector('#app')

Context.provide(root, {
  router: { go: (path) => (location.href = path) },
  log: console.log
})

const state = {
  count: signal(0),
  double: null,
  todos: signal([{ id: 1, text: 'write it', done: false }]),
  newTodo: signal(''),

  inc(e, el, ctx) { this.count.set(this.count() + 1) },
  addTodo(e, el, ctx) {
    const text = this.newTodo().trim()
    if (!text) return
    this.todos.set([...this.todos(), { id: Date.now(), text, done: false }])
    this.newTodo.set('')
  },
  toggleTodo(e, el, ctx) {
    const info = getItemContext(el)
    if (!info) return
    const id = info.item.id
    this.todos.set(this.todos().map(t => t.id === id ? { ...t, done: !t.done } : t))
  }
}

state.double = computed(() => state.count() * 2)

const app = bind(root, state, { dev: true, autoBind: true })

// later: app.dispose()
──────────────────────────────────────────────────────────── */
