import { bind, signal, computed, effect, getItemContext } from 'assets/rdbl.js'

// ── Helpers ─────────────────────────────────────────────────
function makeTodo(text, done = false) {
  return {
    id:          Date.now() + Math.random(),
    text,
    done,
    textCls:     done ? 'todo-text done' : 'todo-text',
    actionLabel: done ? 'RESTORE' : 'COMPLETE',
  }
}

// ── State ────────────────────────────────────────────────────
const stored = JSON.parse(localStorage.getItem('rdbl-todos') || 'null')

const todos = signal(stored ?? [
  makeTodo('Review mission parameters'),
  makeTodo('Check telemetry systems'),
  makeTodo('Brief the crew'),
  makeTodo('Configure launch sequence', true),
  makeTodo('Preflight checklist', true),
])

const view    = signal('today')
const newTodo = signal('')

// ── Computed ─────────────────────────────────────────────────
const activeTodos    = computed(() => todos().filter(t => !t.done))
const completedTodos = computed(() => todos().filter(t =>  t.done))
const visibleTodos   = computed(() => view() === 'today' ? activeTodos() : completedTodos())
const activeCount    = computed(() => activeTodos().length)
const completedCount = computed(() => completedTodos().length)
const isEmpty        = computed(() => visibleTodos().length === 0)

const isToday        = computed(() => view() === 'today')
const todayTabCls    = computed(() => view() === 'today'     ? 'todo-tab tab-active' : 'todo-tab')
const yesterdayTabCls= computed(() => view() === 'yesterday' ? 'todo-tab tab-active' : 'todo-tab')

const summary = computed(() => {
  const done  = completedTodos().length
  const total = todos().length
  if (total === 0) return 'No missions logged'
  return `${done} of ${total} missions complete`
})

// ── Persistence ───────────────────────────────────────────────
effect(() => {
  localStorage.setItem('rdbl-todos', JSON.stringify(todos()))
})

// ── Handlers ─────────────────────────────────────────────────
function addTodo() {
  const text = newTodo().trim()
  if (!text) return
  todos.set([...todos(), makeTodo(text)])
  newTodo.set('')
}

function toggleTodo(event, el) {
  const { item } = getItemContext(el)
  todos.set(todos().map(t =>
    t.id !== item.id ? t : {
      ...t,
      done:        !t.done,
      textCls:     !t.done ? 'todo-text done' : 'todo-text',
      actionLabel: !t.done ? 'RESTORE' : 'COMPLETE',
    }
  ))
}

function removeTodo(event, el) {
  const { item } = getItemContext(el)
  todos.set(todos().filter(t => t.id !== item.id))
}

// ── Bind ─────────────────────────────────────────────────────
bind(document.querySelector('#todo-app'), {
  todos, newTodo, visibleTodos,
  activeCount, completedCount,
  isEmpty, isToday,
  todayTabCls, yesterdayTabCls,
  summary,
  addTodo,
  toggleTodo,
  removeTodo,
  showToday:     () => view.set('today'),
  showCompleted: () => view.set('completed'),
})

// Submit on Enter
document.querySelector('#todo-app input[model]')
  ?.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo() })
