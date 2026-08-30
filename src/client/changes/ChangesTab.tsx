/**
 * The unified changes tab: one tab, two lenses on "what changed?" — Git
 * (repository truth: staged/unstaged files, commit box, history) and the
 * session round (agent truth: every file the model read, wrote, or edited).
 * Both lenses preview their selections in a shared resizable bottom pane
 * ({@link DiffPane}); git targets can expand into the dedicated diff tab.
 * The active lens and the pane height persist in the tab's meta, so the tab
 * reopens exactly where it was left.
 */
import { useState } from 'react'
import type { TabComponentProps } from '../service.ts'
import { t } from '../locales.ts'
import type { SidebarDiffRef } from '../state.ts'
import { GitLens } from './GitLens.tsx'
import { SessionLens } from './SessionLens.tsx'
import { DiffPane, diffTabOf, type ChangesPreview } from './DiffPane.tsx'
import type { FileOp } from './ops.ts'
import css from './changes.module.css'

/** The default preview pane height (px) before the first drag. */
const PANE_HEIGHT_DEFAULT = 300

type Lens = 'git' | 'session'

/** The persisted tab meta (JSON-serializable; rides the layout). */
interface ChangesMeta {
  lens?: Lens
  previewH?: number
}

export function ChangesTab({ ctx, store, scope, tab, visible, onOpenFile, onOpenDiff }: TabComponentProps) {
  const meta = (tab.meta ?? {}) as ChangesMeta
  const [lens, setLens] = useState<Lens>(meta.lens === 'session' ? 'session' : 'git')
  const [preview, setPreview] = useState<ChangesPreview | null>(null)
  const [paneHeight, setPaneHeight] = useState<number>(
    typeof meta.previewH === 'number' && meta.previewH >= 140 ? meta.previewH : PANE_HEIGHT_DEFAULT,
  )

  /** Persist a meta patch onto the tab (lens choice, pane height). */
  const patchMeta = (patch: ChangesMeta): void => {
    ctx.get('betterSidebar')?.updateTab(tab.id, {
      meta: { ...(tab.meta as ChangesMeta | undefined ?? {}), ...patch },
    })
  }

  const chooseLens = (next: Lens): void => {
    if (next === lens) return
    setLens(next)
    patchMeta({ lens: next })
  }

  /** Preview one git change (worktree file or commit) from the Git lens. */
  const previewGit = (ref: SidebarDiffRef): void => {
    setPreview({ kind: 'git', ref })
  }

  /** Preview one session op (with its best-effort prior content snapshot). */
  const previewOp = (path: string, op: FileOp, prior: string | undefined): void => {
    setPreview({ kind: 'op', path, op, prior })
  }

  const previewKey = (target: ChangesPreview): string => target.kind === 'git'
    ? (target.ref.kind === 'worktree'
        ? `git:w:${target.ref.path}:${target.ref.staged ? 's' : 'u'}`
        : `git:c:${target.ref.hashFull}`)
    : `op:${target.op.callId}`

  return (
    <div className={css.root}>
      <div className={css.lensBar}>
        <div className={css.lensSwitch} role="group" aria-label={t('changes')}>
          <button
            type="button"
            className={css.lensButton}
            data-active={lens === 'git' ? 'true' : undefined}
            aria-pressed={lens === 'git'}
            onClick={() => { chooseLens('git') }}
          >
            {t('changesGitLens')}
          </button>
          <button
            type="button"
            className={css.lensButton}
            data-active={lens === 'session' ? 'true' : undefined}
            aria-pressed={lens === 'session'}
            onClick={() => { chooseLens('session') }}
          >
            {t('changesSessionLens')}
          </button>
        </div>
      </div>
      {lens === 'git'
        ? (
          <GitLens
            scope={scope}
            store={store}
            visible={visible}
            onOpenFile={onOpenFile ?? (() => { /* no-op */ })}
            onPreview={previewGit}
            selectedRef={preview !== null && preview.kind === 'git' ? preview.ref : null}
          />
        )
        : (
          <SessionLens
            ctx={ctx}
            scope={scope}
            visible={visible}
            onPreview={previewOp}
            selectedCallId={preview !== null && preview.kind === 'op' ? preview.op.callId : null}
          />
        )}
      {preview !== null && (
        <DiffPane
          key={previewKey(preview)}
          target={preview}
          scope={scope}
          height={paneHeight}
          onHeightCommit={(height) => { setPaneHeight(height); patchMeta({ previewH: height }) }}
          onClose={() => { setPreview(null) }}
          onExpand={() => {
            if (preview.kind === 'git') onOpenDiff?.(diffTabOf(preview.ref))
          }}
        />
      )}
    </div>
  )
}
