import { bind, signal, computed } from 'assets/rdbl.js'
const query  = signal('')
const length = computed(() => query().length)
const root   = document.querySelector('#model-demo')
root.querySelector('input').setAttribute('model', 'query')
bind(root, { query, length })
