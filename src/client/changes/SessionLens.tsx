/**
 * The session lens of the changes tab: agent truth — every file the model
 * read, wrote, or edited in this session (folded from the session event
 * log), grouped by file, newest first, with kind filters. Clicking an op
 * previews it in the tab's shared bottom pane (see {@link DiffPane}): writes
 * and edits as line diffs, reads as a line-numbered content view, failures
 * as their real error text. Live `tool/call` / `tool/result` events append
 * while the tab is visible (bounded; paused and caught up when hidden).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SidebarSessionEvent } from '../../context-types.ts'
import type { Context } from '../../context-types.ts'
import type { SessionScope } from '../api.ts'
import { relativeTime, t } from '../locales.ts'
import { extractFileOps, groupByFile, knownContentBefore, type FileOp, type FileOpKind } from './ops.ts'
import { formatBytes } from '../diff/rows.ts'
import css from './changes.module.css'

/** Cap on accumulated events: the lens shows the recent window, not eternity. */
const EVENTS_CAP = 4000

/** The op-kind filter chips: 'all' or one concrete kind. */
type OpFilter = 'all' | FileOpKind

export interface SessionLensProps {
  ctx: Context
  scope: SessionScope
  /** Preview one op in the shared bottom pane (with its best-effort prior content). */
  onPreview: (path: string, op: FileOp, prior: string | undefined) => void
  /** The op currently previewed (row highlight); null when the pane is closed. */
  selectedCallId: string | null
  /** Fold events only while the tab is actually visible. */
  visible: boolean
}

export function SessionLens({ ctx, scope, onPreview, selectedCallId, visible }: SessionLensProps) {
  // The event log snapshot seeds the lens once; live tool/call and
  // tool/result events append (bounded) and re-extract while visible.
  const eventsRef = useRef<readonly SidebarSessionEvent[] | null>(null)
  if (eventsRef.current === null) {
    eventsRef.current = ctx.sessions.get(scope.sessionId)?.events ?? []
  }
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (typeof ctx.on !== 'function') return
    const off = ctx.on('session/event', (session: unknown, event: SidebarSessionEvent) => {
      const sessionId = (session as { id?: unknown } | null)?.id
      if (sessionId !== scope.sessionId) return
      if (event.type !== 'tool/call' && event.type !== 'tool/result') return
      const list = [...eventsRef.current ?? [], event]
      eventsRef.current = list.length > EVENTS_CAP ? list.slice(list.length - EVENTS_CAP) : list
      if (visible) setTick(value => value + 1)
    })
    return () => { off() }
  }, [ctx, scope.sessionId, visible])
  // Becoming visible again catches up on events appended while paused.
  useEffect(() => { if (visible) setTick(value => value + 1) }, [visible])

  const ops = useMemo(() => extractFileOps(eventsRef.current ?? []), [tick])
  const [filter, setFilter] = useState<OpFilter>('all')
  const filteredOps = useMemo(
    () => (filter === 'all' ? ops : ops.filter(op => op.kind === filter)),
    [ops, filter],
  )
  const groups = useMemo(() => groupByFile(filteredOps), [filteredOps])
  const counts = useMemo(() => {
    const map = new Map<FileOpKind, number>([['read', 0], ['write', 0], ['edit', 0]])
    for (const op of ops) map.set(op.kind, (map.get(op.kind) ?? 0) + 1)
    return map
  }, [ops])

  const chip = (value: OpFilter, label: string, count: number): ReactNode => (
    <button
      type="button"
      key={value}
      className={css.filterChip}
      data-active={filter === value ? 'true' : undefined}
      onClick={() => { setFilter(value) }}
      aria-pressed={filter === value}
    >
      {label}{value !== 'all' ? ` ${String(count)}` : ''}
    </button>
  )

  return (
    <div className={css.session}>
      <div className={css.filterRow} role="group" aria-label={t('changesSessionLens')}>
        {chip('all', t('changesFilterAll'), ops.length)}
        {chip('write', t('changesWrite'), counts.get('write') ?? 0)}
        {chip('edit', t('changesEdit'), counts.get('edit') ?? 0)}
        {chip('read', t('changesRead'), counts.get('read') ?? 0)}
      </div>
      <div className={css.sessionList}>
        {ops.length === 0 && <div className={css.empty}>{t('changesSessionEmpty')}</div>}
        {ops.length > 0 && filteredOps.length === 0 && <div className={css.empty}>{t('changesFilterEmpty')}</div>}
        {[...groups.entries()].map(([path, fileOps]) => (
          <div key={path} className={css.fileGroup}>
            <div className={css.filePath} title={path}>{path}</div>
            {fileOps.map(op => (
              <button
                type="button"
                key={op.callId}
                className={css.opRow}
                data-op-kind={op.kind}
                data-op-error={op.isError ? 'true' : undefined}
                data-selected={selectedCallId === op.callId ? 'true' : undefined}
                onClick={() => { onPreview(path, op, knownContentBefore(ops, path, op)) }}
              >
                <span className={css.opKind} data-kind={op.kind}>
                  {t(op.kind === 'read' ? 'changesRead' : op.kind === 'write' ? 'changesWrite' : 'changesEdit')}
                </span>
                <span className={css.opTime}>{relativeTime(new Date(op.time).toISOString())}</span>
                {op.running && <span className={css.opFlag}>{t('changesRunning')}</span>}
                {op.isError && <span className={css.opFlagError}>{t('changesError')}</span>}
                {op.kind !== 'read' && !op.isError && (
                  <span className={css.opSize}>
                    {formatBytes(new Blob([op.edit?.newString ?? op.content ?? '']).size)}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
