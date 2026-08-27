/**
 * Insert text into the current session's composer draft through the
 * conversation service — the shared path behind the explorer's @-reference
 * button and the viewer selection popup. The service is resolved lazily
 * through `ctx.get` (the inject-free read the app's own plugins use); a
 * missing service or scope degrades to a logged no-op, never a crash.
 *
 * Insert position (fixes upstream issue #425): the draft store only exposes
 * the whole string (`getSnapshot().draft` + `setDraft(text)`) — there is no
 * caret API on the conversation service. The composer's `<textarea>` keeps
 * its last selection even while unfocused, so the live caret is probed from
 * the DOM (guarded by a value-sync check), and the text is spliced at that
 * position, replacing any live selection — with whitespace-aware joins, an
 * insert into the middle of a sentence keeps single-space separation like
 * the append path. An unknown/stale caret falls back to appending at the
 * end (the pre-fix behavior).
 */
import type { Context, SidebarConversation } from '../context-types.ts'

/** A resolved composer caret/selection in draft coordinates. */
export interface DraftCaret {
  start: number
  end: number
}

/**
 * Splice `text` into `draft` at `caret` (replacing any live selection) with
 * whitespace-aware joins. `caret === null` (position unknown) appends at the
 * end, exactly like the original behavior. Pure string math — unit-tested
 * directly.
 */
export function insertAtCaret(draft: string, text: string, caret: DraftCaret | null): string {
  if (caret === null || draft === '') {
    return draft.trim() === '' ? text : `${draft} ${text}`
  }
  const prefix = draft.slice(0, caret.start)
  const suffix = draft.slice(caret.end)
  if (prefix === '' && suffix === '') return text
  // One separating space, but never doubled against adjacent whitespace
  // (or the string edges) — mirrors how typing in the middle of a sentence
  // behaves.
  const left = prefix === '' || /\s$/.test(prefix) ? '' : ' '
  const right = suffix === '' || /^\s/.test(suffix) ? '' : ' '
  return `${prefix}${left}${text}${right}${suffix}`
}

/**
 * Resolve the composer's live caret from its DOM `<textarea>`. The draft
 * store has no caret API, so the sidebar reads the composed input's selection
 * directly; the value-sync check (`el.value === draft`) discards stale or
 * wrong-composer reads — a caret must never be applied against a draft it
 * was not measured on.
 *
 * Returns null when the composer is missing, disabled/read-only, out of
 * sync with the store draft, or has no measurable selection (jsdom/odd
 * hosts report null selectionStart/End).
 */
export function probeComposerCaret(draft: string): DraftCaret | null {
  if (typeof document === 'undefined') return null
  // The active composer lives in the conversation column; prefer its
  // `data-phase`-tagged textarea (the composer's marker), falling back to
  // any textarea in the column, then to a bare data-phase textarea (older
  // host layouts without the column attribute).
  const column = document.querySelector('#root [data-slot="conversation"]')
  const find = (scope: ParentNode): HTMLTextAreaElement | null =>
    scope.querySelector('textarea[data-phase]') ?? scope.querySelector('textarea')
  const el = column !== null
    ? find(column)
    : document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')
  if (el === null || el.disabled || el.readOnly) return null
  if (el.value !== draft) return null
  let start = el.selectionStart
  let end = el.selectionEnd
  if (typeof start !== 'number' || typeof end !== 'number') return null
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.max(0, Math.min(start, draft.length))
  end = Math.max(start, Math.min(end, draft.length))
  return { start, end }
}

/**
 * Insert `text` into the session's composer draft at the composer's live
 * caret (see {@link probeComposerCaret}), falling back to appending at the
 * end when the caret cannot be resolved. Returns false — and logs — when the
 * conversation service or the session scope is unavailable.
 */
export function appendToDraft(ctx: Context, sessionId: string, text: string): boolean {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return false
    const conversation = ctx.get('conversation') as SidebarConversation | undefined
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(insertAtCaret(draft, text, probeComposerCaret(draft)))
    return true
  } catch (error) {
    console.warn('[dsh-better-sidebar] draft insert failed:', error)
    return false
  }
}