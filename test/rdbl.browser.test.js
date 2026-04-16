import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rdblSrc = readFileSync(resolve(import.meta.dir, '../src/rdbl.js'), 'utf8')

function makePage(body, script) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
${body}
<script type="module">
  const _w = []
  const _logs = []
  const _orig = console.warn
  const _origLog = console.log
  console.warn = (...a) => { _w.push(a.map(String).join(' ')); _orig(...a) }
  console.log = (...a) => { _logs.push(a.map(String).join(' ')); _origLog(...a)}
  window.__rdblWarnings = () => JSON.stringify(_w.filter(w => w.includes('[rdbljs]')))
  window.__rdblLogs = () => JSON.stringify(_logs.filter(w => w.includes('[rdbljs]')))
  ${rdblSrc.replace(/<\/script>/g, '<\\/script>')}

  ${script}
</script>
</body></html>`
}

// ── routes ────────────────────────────────────────────────────────────────────

const ROUTES = {

  // ── data-ssr ──────────────────────────────────────────────────────────────

  '/ssr': makePage(
    `<div each="hubs" key="hub_id" class="hub-group">
      <div class="hub-header">
        <span text="name" class="hub-name">Dev Hub</span>
      </div>
      <ul class="channel-list" each="channels" key="channel_id">
        <li cls="channelItemClass">
          <a attr="href:url" text="label" class="channel-link">general</a>
        </li>
      </ul>
      <template>
        <div class="hub-header">
          <span text="name" class="hub-name"></span>
        </div>
        <ul class="channel-list" each="channels" key="channel_id">
          <template>
            <li cls="channelItemClass">
              <a attr="href:url" text="label" class="channel-link"></a>
            </li>
          </template>
        </ul>
      </template>
    </div>`,
    `const scope = {
      hubs: signal([{
        hub_id: 1, name: 'Dev Hub', channelItemClass: 'channel-item',
        channels: [{ channel_id: 1, label: 'general', url: '/channels/general' }]
      }])
    }
    bind(document.querySelector('[each="hubs"]'), scope, { dev: true })`
  ),

  '/missing-inner-template': makePage(
    `<div each="hubs" key="hub_id">
      <template>
        <div class="hub-header"><span text="name"></span></div>
        <ul each="channels" key="channel_id">
          <!-- intentionally no <template> here -->
          <li text="label"></li>
        </ul>
      </template>
    </div>`,
    `const scope = {
      hubs: signal([{
        hub_id: 1, name: 'Dev Hub',
        channels: [{ channel_id: 1, label: 'general' }]
      }])
    }
    bind(document.querySelector('[each="hubs"]'), scope, { dev: true })`
  ),

  '/ssr-reactive': makePage(
    `<div each="hubs" key="hub_id">
      <span id="ssrElementId" text="name" class="hub-name">Old SSR Name</span>
      <template>
        <span text="name" class="hub-name"></span>
      </template>
    </div>`,
    `const scope = {
      hubs: signal([{ hub_id: 1, name: 'Reactive Name' }])
    }
    bind(document.querySelector('[each="hubs"]'), scope, { dev: true })
    window.__getName = () => document.querySelector('.hub-name').textContent
    window.__updateName = v => scope.hubs.set([{ hub_id: 1, name: v }])`
  ),

  '/ssr-reactive-just-render': makePage(
    `<div each="hubs" key="hub_id">
      <span id="ssrElementId" data-key="1" text="name" class="hub-name">Old SSR Name</span>
      <template>
        <span text="name" class="hub-name"></span>
      </template>
    </div>`,
    `const scope = {
      hubs: signal([{ hub_id: 1, name: '' }])
    }
    bind(document.querySelector('[each="hubs"]'), scope, { dev: true })
    window.__getSsrElement = () => document.getElementById('ssrElementId').textContent`
  ),

  // ── each + data-key hydration ─────────────────────────────────────────────
  // <template> used for new items; data-key rows hydrate the live Map so SSR
  // nodes stay in place and become reactive without being replaced on bind.

  '/each-data-key': makePage(
    `<ul id="list" each="items" key="id">
      <li data-key="1" text="name">Alpha</li>
      <li data-key="2" text="name">Beta</li>
      <template><li text="name"></li></template>
    </ul>`,
    `const scope = { items: signal([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]) }
    bind(document.getElementById('list'), scope, { dev: true })
    window.__itemTexts = () => JSON.stringify([...document.querySelectorAll('li')].map(e => e.textContent))
    window.__addItem  = () => scope.items.set([...scope.items(), { id: 3, name: 'Gamma' }])
    window.__removeFirst = () => scope.items.set(scope.items().slice(1))
    window.__updateFirst = name => scope.items.set([{ id: 1, name }, ...scope.items().slice(1)])`
  ),

  // ── each ──────────────────────────────────────────────────────────────────

  '/each-add': makePage(
    `<ul id="list" each="items" key="id">
      <template><li text="name"></li></template>
    </ul>`,
    `const scope = { items: signal([{ id: 1, name: 'Alpha' }]) }
    bind(document.getElementById('list'), scope, { dev: true })
    window.__addItem = () => scope.items.set([...scope.items(), { id: 2, name: 'Beta' }])
    window.__itemTexts = () => JSON.stringify([...document.querySelectorAll('li')].map(e => e.textContent))`
  ),

  '/each-remove': makePage(
    `<ul id="list" each="items" key="id">
      <template><li text="name"></li></template>
    </ul>`,
    `const scope = { items: signal([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]) }
    bind(document.getElementById('list'), scope, { dev: true })
    window.__removeFirst = () => scope.items.set(scope.items().slice(1))
    window.__itemTexts = () => JSON.stringify([...document.querySelectorAll('li')].map(e => e.textContent))`
  ),

  '/each-reorder': makePage(
    `<ul id="list" each="items" key="id">
      <template><li text="name"></li></template>
    </ul>`,
    `const scope = { items: signal([{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]) }
    bind(document.getElementById('list'), scope, { dev: true })
    window.__reorder = () => scope.items.set([{ id: 3, name: 'C' }, { id: 1, name: 'A' }, { id: 2, name: 'B' }])
    window.__itemTexts = () => JSON.stringify([...document.querySelectorAll('li')].map(e => e.textContent))`
  ),

  '/each-missing-key': makePage(
    `<ul each="items" key="id">
      <template><li text="name"></li></template>
    </ul>`,
    `const scope = { items: signal([{ name: 'No ID Here' }]) }
    bind(document.querySelector('[each]'), scope, { dev: true })`
  ),

  '/each-non-array': makePage(
    `<ul each="items" key="id">
      <template><li text="name"></li></template>
    </ul>`,
    `const scope = { items: 'not an array' }
    bind(document.querySelector('[each]'), scope, { dev: true })`
  ),

  '/each-no-template': makePage(
    `<ul each="items" key="id"></ul>`,
    `const scope = { items: signal([{ id: 1, name: 'Item' }]) }
    bind(document.querySelector('[each]'), scope, { dev: true })`
  ),

  // ── text ──────────────────────────────────────────────────────────────────

  '/text-undefined': makePage(
    `<span text="missing"></span>`,
    `bind(document.querySelector('span'), {}, { dev: true })`
  ),

  '/text-ssr-preserves': makePage(
    `<span id="el" text="title">Server Title</span>`,
    `const scope = { title: signal('Client Title') }
    bind(document.getElementById('el'), scope, { dev: true })
    window.__getText = () => document.getElementById('el').textContent
    window.__setTitle = v => scope.title.set(v)`
  ),

  '/text-reactive': makePage(
    `<span id="el" text="msg"></span>`,
    `const scope = { msg: signal('initial') }
    bind(document.getElementById('el'), scope, { dev: true })
    window.__getText = () => document.getElementById('el').textContent
    window.__setMsg = v => scope.msg.set(v)`
  ),

  // ── show ──────────────────────────────────────────────────────────────────

  '/show-toggle': makePage(
    `<div id="el" show="visible">Content</div>`,
    `const scope = { visible: signal(false) }
    bind(document.getElementById('el'), scope, { dev: true })
    window.__isHidden = () => document.getElementById('el').hidden
    window.__setVisible = v => scope.visible.set(v)`
  ),

  // ── attr ──────────────────────────────────────────────────────────────────

  '/attr-binding': makePage(
    `<a id="el" attr="href:url">Link</a>`,
    `const scope = { url: signal(null) }
    bind(document.getElementById('el'), scope, { dev: true })
    window.__getHref = () => document.getElementById('el').getAttribute('href')
    window.__setUrl = v => scope.url.set(v)`
  ),

  // ── cls ───────────────────────────────────────────────────────────────────

  '/cls-string': makePage(
    `<div id="el" cls="className">Content</div>`,
    `const scope = { className: signal('initial') }
    bind(document.getElementById('el'), scope, { dev: true })
    window.__getClass = () => document.getElementById('el').className
    window.__setClass = v => scope.className.set(v)`
  ),

  '/cls-object': makePage(
    `<div id="el" cls="classes">Content</div>`,
    `const scope = { classes: signal({ active: true, disabled: false }) }
    bind(document.getElementById('el'), scope, { dev: true })
    window.__hasClass = cls => document.getElementById('el').classList.contains(cls)
    window.__setClasses = json => scope.classes.set(JSON.parse(json))`
  ),

  // ── model ─────────────────────────────────────────────────────────────────

  '/model-input': makePage(
    `<input id="inp" model="search">`,
    `const scope = { search: signal('initial') }
    bind(document.getElementById('inp'), scope, { dev: true })
    window.__getInputValue = () => document.getElementById('inp').value
    window.__getSignalValue = () => scope.search()
    window.__typeValue = v => {
      const inp = document.getElementById('inp')
      inp.value = v
      inp.dispatchEvent(new Event('input'))
    }`
  ),

  '/model-checkbox': makePage(
    `<input id="cb" type="checkbox" model="isChecked">`,
    `const scope = { isChecked: signal(false) }
    bind(document.getElementById('cb'), scope, { dev: true })
    window.__isChecked = () => document.getElementById('cb').checked
    window.__getSignalValue = () => scope.isChecked()
    window.__toggle = checked => {
      const cb = document.getElementById('cb')
      cb.checked = checked
      cb.dispatchEvent(new Event('change'))
    }`
  ),

  '/model-non-signal': makePage(
    `<input id="inp" model="name">`,
    `const scope = { name: 'just a string' }
    bind(document.getElementById('inp'), scope, { dev: true })`
  ),

  // ── events ────────────────────────────────────────────────────────────────

  '/events-handler': makePage(
    `<button id="btn" onclick="handleClick">Click</button>`,
    `let callCount = 0
    const scope = { handleClick(e, el, ctx) { callCount++ } }
    bind(document.getElementById('btn'), scope, { dev: true })
    window.__click = () => { document.getElementById('btn').click(); return callCount }`
  ),

  '/events-return-false': makePage(
    `<button id="btn" onclick="handleClick">Click</button>`,
    `const scope = { handleClick() { return false } }
    bind(document.getElementById('btn'), scope, { dev: true })
    window.__testClick = () => {
      let propagated = false
      document.body.addEventListener('click', () => { propagated = true }, { once: true })
      const e = new MouseEvent('click', { bubbles: true, cancelable: true })
      document.getElementById('btn').dispatchEvent(e)
      return JSON.stringify({ defaultPrevented: e.defaultPrevented, propagated })
    }`
  ),

  '/events-non-function': makePage(
    `<button id="btn" onclick="notAFunction">Click</button>`,
    `const scope = { notAFunction: 'just a string' }
    bind(document.getElementById('btn'), scope, { dev: true })
    window.__click = () => document.getElementById('btn').click()`
  ),

  // ── dispose ───────────────────────────────────────────────────────────────

  '/dispose-stops-updates': makePage(
    `<span id="el" text="msg"></span>`,
    `const scope = { msg: signal('initial') }
    const binding = bind(document.getElementById('el'), scope, { dev: true })
    window.__getText = () => document.getElementById('el').textContent
    window.__setMsg = v => scope.msg.set(v)
    window.__dispose = () => binding.dispose()`
  ),

  // ── Context ───────────────────────────────────────────────────────────────

  '/context': makePage(
    `<div id="root"><button id="btn" onclick="doAction">Click</button></div>`,
    `const root = document.getElementById('root')
    Context.provide(root, { service: 'ctx-service' })
    let received = null
    const scope = { doAction(e, el, ctx) { received = ctx?.service ?? null } }
    bind(root, scope, { dev: true })
    window.__click = () => { document.getElementById('btn').click(); return received }`
  ),

  // ── getItemContext ────────────────────────────────────────────────────────

  '/item-context': makePage(
    `<ul id="list" each="items" key="id">
      <template><li onclick="onItemClick" text="name"></li></template>
    </ul>`,
    `let captured = null
    const scope = {
      items: signal([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]),
      onItemClick(e, el) { captured = getItemContext(el) }
    }
    bind(document.getElementById('list'), scope, { dev: true })
    window.__clickItem = i => document.querySelectorAll('li')[i].click()
    window.__getCaptured = () => JSON.stringify({ item: captured?.item, index: captured?.index, key: captured?.key })`
  ),
}

// ── server + helpers ──────────────────────────────────────────────────────────

let server

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      const html = ROUTES[path]
      if (!html) return new Response('Not Found', { status: 404 })
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
  })
})

afterAll(() => server?.stop())

// webkit backend is macOS-only (uses system WebKit.framework, zero deps).
// On Linux CI, use the chrome backend — Chrome/Chromium is pre-installed on
// GitHub Actions ubuntu runners and is auto-detected from standard locations.
const webviewOptions = process.platform !== 'darwin' ? { backend: 'chrome' } : {}

function withPage(path, fn) {
  return async () => {
    const wv = new Bun.WebView({ url: `http://localhost:${server.port}${path}`, ...webviewOptions })
    await new Promise(r => { wv.onNavigated = r })
    await wv.evaluate('new Promise(r => setTimeout(r, 50))')
    try {
      await fn(wv)
    } finally {
      wv.close()
    }
  }
}

async function warnings(wv) {
  return JSON.parse(await wv.evaluate('window.__rdblWarnings()'))
}

async function logs(wv) {
  return JSON.parse(await wv.evaluate('window.__rdblLogs()'))
}

async function flush(wv) {
  await wv.evaluate('new Promise(r => setTimeout(r, 20))')
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('data-ssr', () => {
  test('no warnings with nested each when inner each has a template',
    withPage('/ssr', async wv => {
      expect(await warnings(wv)).toEqual([])
    })
  )

  test('warns when inner each is missing a template',
    withPage('/missing-inner-template', async wv => {
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('each="channels" requires a <template> child')
      ])
    })
  )

  test('reactive updates work after SSR bind',
    withPage('/ssr-reactive', async wv => {
      expect(await wv.evaluate('window.__getName()')).toBe('Reactive Name')
      await wv.evaluate('window.__updateName("Updated Name")')
      await flush(wv)
      expect(await wv.evaluate('window.__getName()')).toBe('Updated Name')
    })
  )

  test("data-key alone preserves SSR content — no data-ssr required",
    withPage('/ssr-reactive-just-render', async wv => {
      // scope.name is '' but SSR shows 'Old SSR Name'; data-key infers skipFirst
      expect(await wv.evaluate('window.__getSsrElement()')).toBe('Old SSR Name')
    })
  )
})

describe('each + data-key hydration', () => {
  test('SSR rows stay in place on bind — no replacement on first render',
    withPage('/each-data-key', async wv => {
      // Both items come from scope data matching the SSR values.
      // The key assertion: no warnings (no spurious "requires a <template>" etc.)
      expect(await warnings(wv)).toEqual([])
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Alpha', 'Beta'])
    })
  )

  test('reactive text updates work on hydrated rows',
    withPage('/each-data-key', async wv => {
      await wv.evaluate('window.__updateFirst("Alpha Updated")')
      await flush(wv)
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Alpha Updated', 'Beta'])
    })
  )

  test('new item added via signal uses the template',
    withPage('/each-data-key', async wv => {
      await wv.evaluate('window.__addItem()')
      await flush(wv)
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Alpha', 'Beta', 'Gamma'])
    })
  )

  test('removing an item via signal removes its row',
    withPage('/each-data-key', async wv => {
      await wv.evaluate('window.__removeFirst()')
      await flush(wv)
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Beta'])
    })
  )
})

describe('each', () => {
  test('adds item to list',
    withPage('/each-add', async wv => {
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Alpha'])
      await wv.evaluate('window.__addItem()')
      await flush(wv)
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Alpha', 'Beta'])
    })
  )

  test('removes item from list',
    withPage('/each-remove', async wv => {
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Alpha', 'Beta'])
      await wv.evaluate('window.__removeFirst()')
      await flush(wv)
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['Beta'])
    })
  )

  test('reorders list items',
    withPage('/each-reorder', async wv => {
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['A', 'B', 'C'])
      await wv.evaluate('window.__reorder()')
      await flush(wv)
      expect(JSON.parse(await wv.evaluate('window.__itemTexts()'))).toEqual(['C', 'A', 'B'])
    })
  )

  test('warns when item is missing its key field',
    withPage('/each-missing-key', async wv => {
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('item missing key "id"')
      ])
    })
  )

  test('warns when path resolves to a non-array',
    withPage('/each-non-array', async wv => {
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('did not resolve to an array')
      ])
    })
  )

  test('warns when each host has no template',
    withPage('/each-no-template', async wv => {
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('requires a <template> child')
      ])
    })
  )
})

describe('text', () => {
  test('warns when path resolves to undefined',
    withPage('/text-undefined', async wv => {
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('text="missing" resolved to undefined')
      ])
    })
  )

  test('data-ssr preserves existing content on first bind',
    withPage('/text-ssr-preserves', async wv => {
      expect(await wv.evaluate('window.__getText()')).toBe('Server Title')
      await wv.evaluate('window.__setTitle("New Title")')
      await flush(wv)
      expect(await wv.evaluate('window.__getText()')).toBe('New Title')
    })
  )

  test('updates textContent when signal changes',
    withPage('/text-reactive', async wv => {
      expect(await wv.evaluate('window.__getText()')).toBe('initial')
      await wv.evaluate('window.__setMsg("updated")')
      await flush(wv)
      expect(await wv.evaluate('window.__getText()')).toBe('updated')
    })
  )
})

describe('show', () => {
  test('hides element when value is falsy, shows when truthy',
    withPage('/show-toggle', async wv => {
      expect(await wv.evaluate('window.__isHidden()')).toBe(true)
      await wv.evaluate('window.__setVisible(true)')
      await flush(wv)
      expect(await wv.evaluate('window.__isHidden()')).toBe(false)
    })
  )
})

describe('attr', () => {
  test('removes attribute when value is null, sets it when truthy',
    withPage('/attr-binding', async wv => {
      expect(await wv.evaluate('window.__getHref()')).toBeNull()
      await wv.evaluate('window.__setUrl("/path")')
      await flush(wv)
      expect(await wv.evaluate('window.__getHref()')).toBe('/path')
      await wv.evaluate('window.__setUrl(false)')
      await flush(wv)
      expect(await wv.evaluate('window.__getHref()')).toBeNull()
    })
  )
})

describe('cls', () => {
  test('sets className when value is a string',
    withPage('/cls-string', async wv => {
      expect(await wv.evaluate('window.__getClass()')).toBe('initial')
      await wv.evaluate('window.__setClass("active selected")')
      await flush(wv)
      expect(await wv.evaluate('window.__getClass()')).toBe('active selected')
    })
  )

  test('toggles individual classes when value is an object',
    withPage('/cls-object', async wv => {
      expect(await wv.evaluate('window.__hasClass("active")')).toBe(true)
      expect(await wv.evaluate('window.__hasClass("disabled")')).toBe(false)
      await wv.evaluate('window.__setClasses(\'{"active":false,"disabled":true}\')')
      await flush(wv)
      expect(await wv.evaluate('window.__hasClass("active")')).toBe(false)
      expect(await wv.evaluate('window.__hasClass("disabled")')).toBe(true)
    })
  )
})

describe('model', () => {
  test('syncs signal to input value on bind, then input to signal on input event',
    withPage('/model-input', async wv => {
      expect(await wv.evaluate('window.__getInputValue()')).toBe('initial')
      await wv.evaluate('window.__typeValue("hello")')
      expect(await wv.evaluate('window.__getSignalValue()')).toBe('hello')
    })
  )

  test('syncs checkbox checked state to signal on change event',
    withPage('/model-checkbox', async wv => {
      expect(await wv.evaluate('window.__isChecked()')).toBe(false)
      await wv.evaluate('window.__toggle(true)')
      expect(await wv.evaluate('window.__getSignalValue()')).toBe(true)
    })
  )

  test('warns when binding target is not a signal',
    withPage('/model-non-signal', async wv => {
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('model="name" must resolve to a signal')
      ])
    })
  )
})

describe('events', () => {
  test('calls handler with event, element, and context arguments',
    withPage('/events-handler', async wv => {
      expect(await wv.evaluate('window.__click()')).toBe(1)
    })
  )

  test('returning false from handler prevents default and stops propagation',
    withPage('/events-return-false', async wv => {
      const result = JSON.parse(await wv.evaluate('window.__testClick()'))
      expect(result.defaultPrevented).toBe(true)
      expect(result.propagated).toBe(false)
    })
  )

  test('warns when action path does not resolve to a function',
    withPage('/events-non-function', async wv => {
      await wv.evaluate('window.__click()')
      expect(await warnings(wv)).toEqual([
        expect.stringContaining('did not resolve to a function')
      ])
    })
  )
})

describe('dispose', () => {
  test('stops reactive DOM updates after dispose is called',
    withPage('/dispose-stops-updates', async wv => {
      expect(await wv.evaluate('window.__getText()')).toBe('initial')
      await wv.evaluate('window.__setMsg("updated")')
      await flush(wv)
      expect(await wv.evaluate('window.__getText()')).toBe('updated')
      await wv.evaluate('window.__dispose()')
      await wv.evaluate('window.__setMsg("post-dispose")')
      await flush(wv)
      expect(await wv.evaluate('window.__getText()')).toBe('updated')
    })
  )
})

describe('Context', () => {
  test('provides context from parent element, readable by event handlers in children',
    withPage('/context', async wv => {
      expect(await wv.evaluate('window.__click()')).toBe('ctx-service')
    })
  )
})

describe('getItemContext', () => {
  test('returns item, index, and key for the clicked row',
    withPage('/item-context', async wv => {
      await wv.evaluate('window.__clickItem(1)')
      const captured = JSON.parse(await wv.evaluate('window.__getCaptured()'))
      expect(captured.item).toEqual({ id: 2, name: 'Beta' })
      expect(captured.index).toBe(1)
      expect(captured.key).toBe(2)
    })
  )
})
