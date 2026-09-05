/**
 * The Kanban board tab: columns of task cards with HTML5 drag-and-drop between
 * columns, inline add/edit, claim-to-me, and a progress header derived from the
 * board stats. UI-first (M4) — persisted locally; the completed cards are the
 * contribution signal the governance graphs (M5) will read. The signed-in
 * wallet is the identity used for "claim".
 */
import { useRef, useState, type DragEvent, type MutableRefObject, type ReactNode } from 'react'
import css from './KanbanView.module.css'
import { t, type CopyKey } from './locales.ts'
import { shortAddress, useWallet, type WalletStore } from './wallet.ts'
import { COLUMNS, useKanban, type ColumnId, type KanbanStore, type Task } from './kanban-data.ts'

const DRAG_MIME = 'application/x-dsh-kanban'

export function KanbanTabIcon({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="6" height="18" rx="1" />
      <rect x="10.5" y="3" width="6" height="12" rx="1" />
      <rect x="18" y="3" width="3" height="8" rx="1" />
    </svg>
  )
}

function IconPlus(): ReactNode {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}
function IconX(): ReactNode {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
}

/** One card: draggable, click title to edit, chips for weight and assignee. */
function Card({ task, store, me, dragId, onDropBefore }: {
  task: Task
  store: KanbanStore
  me: string | undefined
  /** Shared "currently dragging" id — reliable across the drag events where
   *  dataTransfer.getData is protected (and a browser-robustness improvement). */
  dragId: MutableRefObject<string | null>
  onDropBefore: (event: DragEvent, beforeId: string) => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [weight, setWeight] = useState(String(task.weight))
  const mine = task.assignee !== undefined && task.assignee === me

  const save = (): void => {
    const w = Number(weight)
    store.update(task.id, { title, weight: Number.isFinite(w) && w >= 0 ? w : task.weight })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={css.card}>
        <textarea className={css.editTitle} value={title} autoFocus rows={2}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() } if (e.key === 'Escape') setEditing(false) }} />
        <div className={css.editRow}>
          <label className={css.editWeight}>
            <input type="number" min="0" value={weight} onChange={(e) => setWeight(e.target.value)} /> {t('kanbanPts')}
          </label>
          <span className={css.editActions}>
            <button type="button" className={css.ghostSm} onClick={() => setEditing(false)}>{t('w3Back')}</button>
            <button type="button" className={css.primarySm} onClick={save}>{t('save')}</button>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={css.card}
      draggable
      onDragStart={(e) => { dragId.current = task.id; e.dataTransfer.setData(DRAG_MIME, task.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { dragId.current = null }}
      onDragOver={(e) => { if (dragId.current !== null || e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault() }}
      onDrop={(e) => onDropBefore(e, task.id)}
    >
      <button type="button" className={css.cardTitle} onClick={() => { setTitle(task.title); setWeight(String(task.weight)); setEditing(true) }} title={t('kanbanEditHint')}>
        {task.title}
      </button>
      <div className={css.cardFoot}>
        <span className={css.weightChip}>{task.weight} {t('kanbanPts')}</span>
        <button type="button" className={`${css.assignChip} ${mine ? css.assignMine : ''}`}
          onClick={() => store.claim(task.id, mine ? undefined : me)}
          title={me === undefined ? t('kanbanClaimNoWallet') : mine ? t('kanbanUnclaim') : t('kanbanClaimMe')}
          disabled={me === undefined && task.assignee === undefined}>
          {task.assignee !== undefined ? shortAddress(task.assignee) : t('kanbanClaim')}
        </button>
        <button type="button" className={css.del} aria-label={t('close')} onClick={() => store.remove(task.id)}><IconX /></button>
      </div>
    </div>
  )
}

/** One column: header with count, a scrolling body of cards, and an add box. */
function Column({ col, tasks, store, me, dragId }: { col: { id: ColumnId; labelKey: string }; tasks: Task[]; store: KanbanStore; me: string | undefined; dragId: MutableRefObject<string | null> }): ReactNode {
  const [over, setOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const onColumnDrop = (event: DragEvent, beforeId?: string): void => {
    // Prefer the ref (set on dragstart); fall back to dataTransfer for a real
    // cross-window drag where the ref would be empty.
    const id = dragId.current ?? event.dataTransfer.getData(DRAG_MIME)
    setOver(false)
    dragId.current = null
    if (id === '' || id === beforeId) return
    event.preventDefault()
    event.stopPropagation()
    store.move(id, col.id, beforeId)
  }
  const addCard = (): void => {
    if (draft.trim() === '') { setAdding(false); return }
    store.add({ title: draft, column: col.id })
    setDraft('')
  }

  return (
    <section
      className={`${css.column} ${over ? css.columnOver : ''}`}
      onDragOver={(e) => { if (dragId.current !== null || e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => onColumnDrop(e)}
    >
      <header className={css.columnHead}>
        <span className={`${css.colDot} ${css[`dot_${col.id}`] ?? ''}`} />
        <span className={css.colName}>{t(col.labelKey as CopyKey)}</span>
        <span className={css.colCount}>{tasks.length}</span>
        <button type="button" className={css.colAdd} aria-label={t('kanbanAdd')} onClick={() => setAdding(true)}><IconPlus /></button>
      </header>
      <div className={css.columnBody}>
        {tasks.map(task => (
          <Card key={task.id} task={task} store={store} me={me} dragId={dragId}
            onDropBefore={(e, beforeId) => onColumnDrop(e, beforeId)} />
        ))}
        {adding ? (
          <div className={css.addBox}>
            <textarea className={css.editTitle} value={draft} autoFocus rows={2} placeholder={t('kanbanNewCard')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCard() } if (e.key === 'Escape') { setDraft(''); setAdding(false) } }}
              onBlur={addCard} />
          </div>
        ) : (
          <button type="button" className={css.addRow} onClick={() => setAdding(true)}><IconPlus /> {t('kanbanAdd')}</button>
        )}
      </div>
    </section>
  )
}

export function KanbanView({ store, wallet }: { store: KanbanStore; wallet: WalletStore }): ReactNode {
  const tasks = useKanban(store)
  const me = useWallet(wallet).account?.address
  const dragId = useRef<string | null>(null)
  const stats = store.stats()
  const pct = Math.round(stats.progress * 100)
  const byColumn = (id: ColumnId): Task[] => tasks.filter(t => t.column === id).sort((a, b) => a.order - b.order)

  return (
    <div className={css.board}>
      <header className={css.boardHeader}>
        <div className={css.boardTop}>
          <span className={css.boardMark}><KanbanTabIcon size={17} /></span>
          <div className={css.boardTitles}>
            <div className={css.boardTitle}>{t('kanbanTitle')}</div>
            <div className={css.boardSub}>{me !== undefined ? shortAddress(me) : t('kanbanNoWallet')}</div>
          </div>
          <div className={css.boardStat}>
            <span className={css.boardStatNum}>{pct}%</span>
            <span className={css.boardStatLabel}>{t('kanbanDoneLabel')}</span>
          </div>
        </div>
        <div className={css.progress}><div className={css.progressFill} style={{ width: `${pct}%` }} /></div>
      </header>
      <div className={css.columns}>
        {COLUMNS.map(col => (
          <Column key={col.id} col={col} tasks={byColumn(col.id)} store={store} me={me} dragId={dragId} />
        ))}
      </div>
      <div className={css.previewNote}>{t('kanbanPreviewNote')}</div>
    </div>
  )
}
