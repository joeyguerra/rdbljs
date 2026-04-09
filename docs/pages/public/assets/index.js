import { bind, signal, computed } from 'assets/rdbl.js'

const count     = signal(0)
const double    = computed(() => count() * 2)
const status    = computed(() => count() > 0 ? 'NOMINAL' : count() < 0 ? 'ABORT' : 'STANDBY')
const statusCls = computed(() => count() > 0 ? 'green readout-value' : count() < 0 ? 'red readout-value' : 'amber readout-value')
const parity    = computed(() => count() % 2 === 0 ? 'EVEN' : 'ODD')

bind(document.querySelector('#hero-demo'), {
  count, double, status, statusCls, parity,
  increment: () => count.set(count() + 1),
  decrement: () => count.set(count() - 1),
  reset:     () => count.set(0),
})
