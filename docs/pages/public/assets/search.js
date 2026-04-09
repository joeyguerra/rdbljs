import { bind, signal, computed } from 'assets/rdbl.js'

// ── Dataset ──────────────────────────────────────────────────
const MISSIONS = [
  { id:  1, name: 'Mercury-Redstone 3',  year: '1961', status: 'success' },
  { id:  2, name: 'Mercury-Redstone 4',  year: '1961', status: 'success' },
  { id:  3, name: 'Mercury-Atlas 6',     year: '1962', status: 'success' },
  { id:  4, name: 'Gemini 3',            year: '1965', status: 'success' },
  { id:  5, name: 'Gemini 8',            year: '1966', status: 'partial' },
  { id:  6, name: 'Apollo 1',            year: '1967', status: 'failure' },
  { id:  7, name: 'Apollo 7',            year: '1968', status: 'success' },
  { id:  8, name: 'Apollo 8',            year: '1968', status: 'success' },
  { id:  9, name: 'Apollo 10',           year: '1969', status: 'success' },
  { id: 10, name: 'Apollo 11',           year: '1969', status: 'success' },
  { id: 11, name: 'Apollo 12',           year: '1969', status: 'success' },
  { id: 12, name: 'Apollo 13',           year: '1970', status: 'partial' },
  { id: 13, name: 'Apollo 14',           year: '1971', status: 'success' },
  { id: 14, name: 'Apollo 15',           year: '1971', status: 'success' },
  { id: 15, name: 'Apollo 16',           year: '1972', status: 'success' },
  { id: 16, name: 'Apollo 17',           year: '1972', status: 'success' },
  { id: 17, name: 'Skylab 2',            year: '1973', status: 'success' },
  { id: 18, name: 'Apollo-Soyuz',        year: '1975', status: 'success' },
].map(m => ({
  ...m,
  statusLabel: m.status.toUpperCase(),
  statusCls:   `mission-status status-${m.status}`,
}))

// ── Signals ──────────────────────────────────────────────────
const query        = signal('')
const statusFilter = signal('')

// ── Computed ─────────────────────────────────────────────────
const results = computed(() => {
  const q   = query().toLowerCase().trim()
  const sf  = statusFilter()
  return MISSIONS.filter(m => {
    const matchesQ  = !q  || m.name.toLowerCase().includes(q) || m.year.includes(q)
    const matchesSF = !sf || m.status === sf
    return matchesQ && matchesSF
  })
})

const resultCount = computed(() => results().length)
const isEmpty     = computed(() => results().length === 0)

// ── Bind ─────────────────────────────────────────────────────
bind(document.querySelector('#search-app'), {
  query, statusFilter,
  results, resultCount, isEmpty,
})
