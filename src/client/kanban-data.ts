/**
 * The Kanban board's data + store (M4, UI-first).
 *
 * A per-activation store over a small task model, persisted to localStorage so
 * the board survives reloads on one device. This is the co-op's task/bounty
 * board (capability #09) and — deliberately — the DATA SOURCE the governance
 * progression graphs (M5) will read: every card that reaches Done is a
 * contribution event, so the store also derives per-assignee and per-column
 * stats. When the real contribution ledger (#11) lands, it replaces the
 * persistence here behind the same `Task` / `BoardStats` types.
 *
 * localStorage is wrapped in try/catch throughout (private mode / cleared
 * storage / a jsdom without a store must never throw), mirroring the wallet
 * mock.
 */
import { useSyncExternalStore } from 'react'

/** The board columns, in order. `done` is terminal (counts as contribution). */
export type ColumnId = 'backlog' | 'todo' | 'doing' | 'review' | 'done'

/** The ordered column ids and their locale keys (title resolved in the view). */
export const COLUMNS: readonly { id: ColumnId; labelKey: string }[] = [
  { id: 'backlog', labelKey: 'kanbanColBacklog' },
  { id: 'todo', labelKey: 'kanbanColTodo' },
  { id: 'doing', labelKey: 'kanbanColDoing' },
  { id: 'review', labelKey: 'kanbanColReview' },
  { id: 'done', labelKey: 'kanbanColDone' },
]

/** One task card. `assignee` is a wallet address / pseudonym, or undefined. */
export interface Task {
  readonly id: string
  title: string
  column: ColumnId
  /** Bounty weight in contribution points (drives the governance stats). */
  weight: number
  /** The claiming member's address, or undefined while unclaimed. */
  assignee?: string
  /** Monotonic order key within a column (lower = higher). */
  order: number
}

/** Derived board statistics — the seam the governance graphs read. */
export interface BoardStats {
  /** Task count per column. */
  perColumn: Record<ColumnId, number>
  /** Total bounty weight completed (in the done column). */
  completedWeight: number
  /** Completed weight per assignee address (contribution by member). */
  perAssignee: { address: string; weight: number; count: number }[]
  /** Share done: done weight / total weight (0..1) — the progression signal. */
  progress: number
}

/** The Kanban store. */
export interface KanbanStore {
  getSnapshot(): readonly Task[]
  subscribe(listener: () => void): () => void
  add(input: { title: string; column?: ColumnId; weight?: number; assignee?: string }): void
  update(id: string, patch: Partial<Pick<Task, 'title' | 'weight' | 'assignee'>>): void
  remove(id: string): void
  /** Move a task to `column`, placed before `beforeId` (or at the end). */
  move(id: string, column: ColumnId, beforeId?: string): void
  /** Claim/unclaim a task for `address`. */
  claim(id: string, address: string | undefined): void
  stats(): BoardStats
}

const STORAGE_KEY = 'dsh-web3-kanban:v1'
let idSeq = 0
const mintId = (): string => `t${(idSeq += 1)}-${(Math.max(1, idSeq) * 2654435761 % 100000).toString(36)}`

/** The seed board shown before anyone has edited it (clearly demo content). */
function seedTasks(): Task[] {
  const rows: Omit<Task, 'id' | 'order'>[] = [
    { title: 'Wallet login gate', column: 'done', weight: 8 },
    { title: 'Host keystore + Wallet tab', column: 'done', weight: 13 },
    { title: 'Realms governance tab', column: 'done', weight: 13 },
    { title: 'Kanban board (this)', column: 'doing', weight: 8 },
    { title: 'Governance progression graphs', column: 'todo', weight: 8 },
    { title: 'Leaderboard tab', column: 'todo', weight: 5 },
    { title: 'Encrypted anonymous chat', column: 'backlog', weight: 21 },
    { title: 'Contribution ledger (LainDB?)', column: 'backlog', weight: 21 },
    { title: 'Payout rails + fiat off-ramp', column: 'backlog', weight: 13 },
    { title: 'Sidebar overflow fix', column: 'review', weight: 2 },
  ]
  return rows.map((r, i) => ({ ...r, id: mintId(), order: i }))
}

function readStored(): Task[] | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return undefined
    const valid = COLUMNS.map(c => c.id)
    const tasks: Task[] = []
    for (const [i, t] of parsed.entries()) {
      const r = t as Partial<Task>
      if (typeof r.id !== 'string' || typeof r.title !== 'string') continue
      if (!valid.includes(r.column as ColumnId)) continue
      tasks.push({
        id: r.id, title: r.title, column: r.column as ColumnId,
        weight: typeof r.weight === 'number' && r.weight >= 0 ? r.weight : 1,
        assignee: typeof r.assignee === 'string' ? r.assignee : undefined,
        order: typeof r.order === 'number' ? r.order : i,
      })
    }
    return tasks.length > 0 ? tasks : undefined
  } catch {
    return undefined
  }
}

function writeStored(tasks: readonly Task[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)) } catch { /* storage unavailable */ }
}

/** Create the per-activation Kanban store (the createXXXStore() rule). */
export function createKanbanStore(): KanbanStore {
  const listeners = new Set<() => void>()
  let tasks: Task[] = readStored() ?? seedTasks()
  // Advance the id counter past any restored ids so new cards never collide.
  idSeq = Math.max(idSeq, tasks.length)

  const commit = (next: Task[]): void => {
    tasks = next
    writeStored(tasks)
    for (const l of listeners) l()
  }
  const endOrder = (column: ColumnId): number =>
    tasks.filter(t => t.column === column).reduce((m, t) => Math.max(m, t.order + 1), 0)

  return {
    getSnapshot: () => tasks,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    add({ title, column = 'backlog', weight = 3, assignee }) {
      const clean = title.trim()
      if (clean === '') return
      commit([...tasks, { id: mintId(), title: clean, column, weight, assignee, order: endOrder(column) }])
    },
    update(id, patch) {
      commit(tasks.map(t => t.id === id
        ? { ...t, ...('title' in patch && patch.title !== undefined ? { title: patch.title.trim() || t.title } : {}),
            ...('weight' in patch && patch.weight !== undefined ? { weight: Math.max(0, patch.weight) } : {}),
            ...('assignee' in patch ? { assignee: patch.assignee } : {}) }
        : t))
    },
    remove(id) { commit(tasks.filter(t => t.id !== id)) },
    move(id, column, beforeId) {
      const moving = tasks.find(t => t.id === id)
      if (moving === undefined) return
      // Order among the destination column's tasks (excluding the moved one),
      // inserting before `beforeId` or at the end.
      const dest = tasks.filter(t => t.column === column && t.id !== id).sort((a, b) => a.order - b.order)
      const idx = beforeId === undefined ? dest.length : Math.max(0, dest.findIndex(t => t.id === beforeId))
      const insertAt = beforeId === undefined || idx < 0 ? dest.length : idx
      dest.splice(insertAt, 0, { ...moving, column })
      const reordered = new Map(dest.map((t, i) => [t.id, i]))
      commit(tasks.map(t => {
        if (t.id === id) return { ...t, column, order: reordered.get(id) ?? endOrder(column) }
        return reordered.has(t.id) ? { ...t, order: reordered.get(t.id)! } : t
      }))
    },
    claim(id, address) {
      commit(tasks.map(t => t.id === id ? { ...t, assignee: address } : t))
    },
    stats() {
      const perColumn = { backlog: 0, todo: 0, doing: 0, review: 0, done: 0 } as Record<ColumnId, number>
      let total = 0, completed = 0
      const byAssignee = new Map<string, { weight: number; count: number }>()
      for (const t of tasks) {
        perColumn[t.column] += 1
        total += t.weight
        if (t.column === 'done') {
          completed += t.weight
          if (t.assignee !== undefined) {
            const cur = byAssignee.get(t.assignee) ?? { weight: 0, count: 0 }
            byAssignee.set(t.assignee, { weight: cur.weight + t.weight, count: cur.count + 1 })
          }
        }
      }
      const perAssignee = [...byAssignee.entries()]
        .map(([address, v]) => ({ address, ...v }))
        .sort((a, b) => b.weight - a.weight)
      return { perColumn, completedWeight: completed, perAssignee, progress: total === 0 ? 0 : completed / total }
    },
  }
}

/** Subscribe a component to the Kanban store. */
export function useKanban(store: KanbanStore): readonly Task[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
