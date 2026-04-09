import { bind, signal, computed, effect } from 'assets/rdbl.js'

const count = signal(0)
const log   = document.getElementById('effect-log')

const double    = computed(() => count() * 2)
const history   = signal('—')
const status    = computed(() =>
  count() > 0 ? 'NOMINAL' : count() < 0 ? 'ABORT' : 'STANDBY'
)
const statusCls = computed(() =>
  count() > 0 ? 'readout-value green' :
  count() < 0 ? 'readout-value red'   :
                'readout-value amber'
)

// Log every change via effect
let prev = 0
effect(() => {
  const c = count()
  if (c !== 0 || prev !== 0) {
    log.textContent = `count changed: ${prev} → ${c}`
    setTimeout(() => { if (log.textContent.includes(`→ ${c}`) ) log.textContent = '' }, 2000)
  }
  prev = c
})

const recent = []
bind(document.querySelector('#counter-app'), {
  count, double, status, statusCls,
  history,
  increment() {
    count.set(count() + 1)
    recent.unshift(`+1 → ${count()}`)
    history.set(recent.slice(0,3).join(', '))
  },
  decrement() {
    count.set(count() - 1)
    recent.unshift(`-1 → ${count()}`)
    history.set(recent.slice(0,3).join(', '))
  },
  reset() {
    count.set(0)
    recent.length = 0
    history.set('—')
  },
})
