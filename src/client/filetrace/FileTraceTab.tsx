/**
 * The file-trace tab: records every file the model read, wrote, or edited
 * in this session (folded from the session event log) and reviews any op as
 * a line diff (del red / add green / mod blue) or a line-numbered read view,
 * with lightweight syntax coloring whose hues sit between the diff colors.
 * Ported from the standalone dsh-file-trace plugin's panel; the tab can be
 * disabled per user in the Side card settings when the standalone plugin is
 * preferred.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react'
import type { SidebarSessionEvent } from '../../context-types.ts'
import type { TabComponentProps } from '../service.ts'
import { t } from '../locales.ts'
import { extractFileOps, groupByFile, knownContentBefore, parseReadLines, type FileOp } from './ops.ts'
import { diffLines, formatBytes, buildDiffSegments, diffInline, coalesceInline, MIN_FOLD, type DiffRow, type InlineDiff } from './diff.ts'
import { scanLine, isColored, langOfPath, hasBlockComment, type TokenType, type CodeToken } from './highlight.ts'
import css from './filetrace.module.css'

/** Long diff lines fold to one ellipsized row; the threshold is the char count. */
const FOLD_THRESHOLD = 120

/** Cap on accumulated events: the trace shows the recent window, not eternity. */
const EVENTS_CAP = 4000

/** Token class -> CSS color class ('' inherits the row's diff color). */
const TOKEN_CLASS: Readonly<Record<TokenType, string>> = {
  plain: '',
  comment: css.tokComment ?? '',
  string: css.tokString ?? '',
  keyword: css.tokKeyword ?? '',
  number: css.tokNumber ?? '',
  type: css.tokType ?? '',
  function: css.tokFunction ?? '',
  macro: css.tokMacro ?? '',
}

/** One token span's class list: its color class, plus the change tint. */
function tokenSpanClass(type: TokenType, changed: boolean): string {
  const color = TOKEN_CLASS[type]
  return changed ? `${color} ${css.inlineChange}` : color
}

/** Render scanned tokens as colored nodes; uncolored runs stay text. */
function tokensToNodes(tokens: readonly CodeToken[], changed = false): ReactNode[] {
  const nodes: ReactNode[] = []
  for (const token of tokens) {
    if (!changed && !isColored(token)) nodes.push(token.text)
    else nodes.push(<span key={String(nodes.length)} className={tokenSpanClass(token.type, changed)}>{token.text}</span>)
  }
  return nodes
}

/** Per-row block-comment entry state for a diff: the old side threads along
 *  old-line order and the new side along new-line order (the LCS row order
 *  preserves both), so multi-line comments color correctly on each side. */
function diffBlockEntries(rows: readonly DiffRow[], lang: string | undefined): Map<DiffRow, boolean> {
  const entries = new Map<DiffRow, boolean>()
  if (!hasBlockComment(lang)) return entries
  let oldIn = false
  let newIn = false
  for (const row of rows) {
    const isOld = row.oldLine !== undefined
    const isNew = row.newLine !== undefined
    entries.set(row, isOld ? oldIn : newIn)
    if (isOld) oldIn = scanLine(row.text, lang, oldIn).inBlock
    if (isNew) newIn = scanLine(row.text, lang, newIn).inBlock
  }
  return entries
}

/** Diff material for one operation: an edit reconstructs the full file from
 *  the window's known prior content when possible (hunk-style context); a
 *  write with unknown prior content renders all-added. */
function diffOf(op: FileOp, prior: string | undefined): readonly DiffRow[] {
  if (op.kind === 'read') return []
  if (op.kind === 'edit' && op.edit !== undefined) {
    const { oldString, newString } = op.edit
    if (prior !== undefined && prior.includes(oldString)) {
      const newFile = prior.replace(oldString, newString)
      return diffLines(prior, newFile)
    }
    return diffLines(oldString, newString)
  }
  if (op.kind === 'write') {
    const content = op.content ?? ''
    const old = prior !== undefined && prior !== content ? prior : undefined
    return diffLines(old ?? '', content)
  }
  return []
}

/** The file-trace tab body: op list above, selected diff/read pane below. */
export function FileTraceTab({ ctx, scope, visible }: TabComponentProps) {
  // The event log snapshot seeds the trace once; live tool/call and
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
  const groups = useMemo(() => groupByFile(ops), [ops])
  const [selected, setSelected] = useState<{ path: string; op: FileOp } | null>(null)
  // Long diff lines fold to one ellipsized row; the set holds expanded row keys.
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<string>>(new Set())
  // Hunk-fold segments expanded by index; default collapsed.
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<number>>(new Set())
  // Bottom diff pane height in px; drag the handle to resize (min/max clamp).
  const [diffHeight, setDiffHeight] = useState(300)

  const selectedOp = selected?.op
  const selectedLang = useMemo(
    () => selected === null ? undefined : langOfPath(selected.path),
    [selected],
  )
  const diffRows = useMemo(
    () => selectedOp === undefined ? [] : diffOf(selectedOp, knownContentBefore(ops, selected?.path ?? '', selectedOp)),
    [selectedOp, selected?.path, ops],
  )
  const segments = useMemo(() => buildDiffSegments(diffRows), [diffRows])
  // Char-level highlight for mod-row pairs, keyed by (oldLine|newLine).
  const inlineMap = useMemo(() => {
    const map = new Map<string, InlineDiff>()
    let i = 0
    while (i < diffRows.length) {
      if (diffRows[i]!.kind !== 'mod') { i += 1; continue }
      let j = i
      while (j < diffRows.length && diffRows[j]!.kind === 'mod') j += 1
      const block = diffRows.slice(i, j)
      const k = Math.floor(block.length / 2)
      for (let p = 0; p < k; p += 1) {
        const delRow = block[p]!
        const addRow = block[p + k]!
        const r = diffInline(delRow.text, addRow.text)
        map.set(`${String(delRow.oldLine ?? '')}|${String(delRow.newLine ?? '')}`, r)
        map.set(`${String(addRow.oldLine ?? '')}|${String(addRow.newLine ?? '')}`, r)
      }
      i = j
    }
    return map
  }, [diffRows])
  // Block-comment entry state per row, threaded per side.
  const blockEntries = useMemo(() => diffBlockEntries(diffRows, selectedLang), [diffRows, selectedLang])
  // Read view rows with block-comment state threaded down the file's lines.
  const readRows = useMemo(() => {
    if (selectedOp?.kind !== 'read' || selectedOp.read === undefined) return []
    let state = false
    return parseReadLines(selectedOp.read).map((line) => {
      const scan = scanLine(line.text, selectedLang, state)
      state = scan.inBlock
      return { line: line.line, nodes: tokensToNodes(scan.tokens) }
    })
  }, [selectedOp, selectedLang])
  // Reset folding when selecting a different operation.
  useEffect(() => { setExpandedLines(new Set()); setExpandedFolds(new Set()) }, [selectedOp])

  /** One diff row: colored sign + syntax-colored text, long-line fold toggle. */
  const renderDiffRow = (row: DiffRow, rowKey: string, lang: string | undefined): ReactElement => {
    const isLong = row.text.length > FOLD_THRESHOLD
    const isFolded = isLong && !expandedLines.has(rowKey)
    const blockEntry = blockEntries.get(row) ?? false
    return (
      <div
        key={rowKey}
        className={css.diffRow}
        data-kind={row.kind}
        data-folded={isFolded ? 'true' : undefined}
        onClick={isLong ? () => {
          setExpandedLines(prev => {
            const next = new Set(prev)
            if (next.has(rowKey)) next.delete(rowKey)
            else next.add(rowKey)
            return next
          })
        } : undefined}
        title={isFolded ? row.text : undefined}
      >
        <span className={css.lineNo}>{row.oldLine !== undefined ? String(row.oldLine) : ''}</span>
        <span className={css.lineNo}>{row.newLine !== undefined ? String(row.newLine) : ''}</span>
        <span className={css.sign}>{row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : row.kind === 'mod' ? '~' : ' '}</span>
        <span className={css.text} data-folded={isFolded ? 'true' : undefined}>
          {row.kind === 'mod' && (() => {
            const inline = inlineMap.get(`${String(row.oldLine ?? '')}|${String(row.newLine ?? '')}`)
            if (inline === undefined) return tokensToNodes(scanLine(row.text, lang, blockEntry).tokens)
            // Coalesced change runs, each split into syntax tokens with
            // block-comment state threaded across the runs of this line.
            const side = coalesceInline(row.oldLine !== undefined ? inline.old : inline.next)
            const nodes: ReactNode[] = []
            let state = blockEntry
            for (const seg of side) {
              const scan = scanLine(seg.text, lang, state)
              state = scan.inBlock
              nodes.push(...tokensToNodes(scan.tokens, seg.changed))
            }
            return nodes
          })()}
          {row.kind !== 'mod' && tokensToNodes(scanLine(row.text, lang, blockEntry).tokens)}
        </span>
      </div>
    )
  }

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = diffHeight
    const onMove = (ev: PointerEvent): void => {
      setDiffHeight(Math.min(Math.max(startH + (startY - ev.clientY), 140), Math.round(window.innerHeight * 0.7)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className={css.root}>
      <div className={css.list}>
        {ops.length === 0 && <div className={css.empty}>{t('fileTraceEmpty')}</div>}
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
                onClick={() => { setSelected({ path, op }) }}
              >
                <span className={css.opKind} data-kind={op.kind}>{t(op.kind === 'read' ? 'fileTraceRead' : op.kind === 'write' ? 'fileTraceWrite' : 'fileTraceEdit')}</span>
                <span className={css.opTime}>{new Date(op.time).toLocaleTimeString()}</span>
                {op.running && <span className={css.opFlag}>{t('fileTraceRunning')}</span>}
                {op.isError && <span className={css.opFlagError}>{t('fileTraceError')}</span>}
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
      {selected !== null && (
        <div className={css.diffPane} style={{ height: diffHeight }}>
          <div className={css.dragHandle} onPointerDown={onHandleDown} role="separator" aria-orientation="horizontal" />
          <div className={css.diffHead}>
            <span className={css.diffPath}>{selected.path}</span>
            <span className={css.diffKind} data-kind={selected.op.kind}>
              {t(selected.op.kind === 'read' ? 'fileTraceRead' : selected.op.kind === 'write' ? 'fileTraceWrite' : 'fileTraceEdit')}
            </span>
            <button type="button" className={css.close} onClick={() => { setSelected(null) }}>×</button>
          </div>
          {selected.op.isError
            ? (
              <div className={css.readContent} data-error="true">
                <div className={css.readError} role="alert">
                  {selected.op.errorText ?? t('fileTraceError')}
                </div>
              </div>
            )
            : selected.op.kind === 'read'
              ? (
                <div className={css.readContent}>
                  {readRows.map((row) => (
                    <div key={String(row.line)} className={css.readRow}>
                      <span className={css.lineNo}>{String(row.line)}</span>
                      <span className={css.text}>{row.nodes}</span>
                    </div>
                  ))}
                </div>
              )
              : (
                <div className={css.diffRows}>
                  {selected.op.kind === 'write'
                    && knownContentBefore(ops, selected.path, selected.op) === undefined
                    && <div className={css.priorUnknown}>{t('fileTracePriorUnknown')}</div>}
                  {segments.map((segment, segIndex) => {
                    if (segment.kind === 'fold') {
                      const shouldFold = segment.rows.length >= MIN_FOLD
                      const isExpanded = expandedFolds.has(segIndex)
                      if (!shouldFold) {
                        return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang))
                      }
                      return (
                        <div
                          key={`fold-${String(segIndex)}`}
                          className={css.foldRow}
                          data-expanded={isExpanded ? 'true' : undefined}
                          onClick={() => {
                            setExpandedFolds(prev => {
                              const next = new Set(prev)
                              if (next.has(segIndex)) next.delete(segIndex)
                              else next.add(segIndex)
                              return next
                            })
                          }}
                        >
                          {isExpanded
                            ? segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang))
                            : (
                              <span className={css.foldMarker} title={t('fileTraceContext')}>
                                {t('fileTraceFold', { count: segment.rows.length })}
                              </span>
                            )}
                        </div>
                      )
                    }
                    return segment.rows.map((row, index) => renderDiffRow(row, `${segIndex}-${String(index)}`, selectedLang))
                  })}
                </div>
              )}
        </div>
      )}
    </div>
  )
}
