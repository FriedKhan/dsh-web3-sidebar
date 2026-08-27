/**
 * conversation-draft spec — the caret-resolved composer insertion (upstream
 * issue #425 ②). `insertAtCaret` is pure string math (splice with
 * whitespace-aware joins); `probeComposerCaret` reads the live composer
 * `<textarea>` selection out of the DOM, guarded by a value-sync check so a
 * stale or wrong-composer caret is never applied.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { insertAtCaret, probeComposerCaret } from '../src/client/conversation-draft.ts'

/**
 * Mount a fake composer textarea inside the DSH conversation column
 * (`#root [data-slot="conversation"] textarea[data-phase]`).
 */
function mountComposer(draft: string, selectionStart: number, selectionEnd: number): HTMLTextAreaElement {
  const root = document.createElement('div')
  root.id = 'root'
  const column = document.createElement('div')
  column.setAttribute('data-slot', 'conversation')
  const textarea = document.createElement('textarea')
  textarea.setAttribute('data-phase', 'plain')
  textarea.value = draft
  textarea.setSelectionRange(selectionStart, selectionEnd)
  column.append(textarea)
  root.append(column)
  document.body.append(root)
  return textarea
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('probeComposerCaret', () => {
  it('returns the textarea selection when the DOM is in sync with the draft', () => {
    mountComposer('hello world', 5, 5)
    expect(probeComposerCaret('hello world')).toEqual({ start: 5, end: 5 })
  })

  it('reports a live selection range, not just a collapsed caret', () => {
    mountComposer('hello world', 6, 11)
    expect(probeComposerCaret('hello world')).toEqual({ start: 6, end: 11 })
  })

  it('returns null when no composer is mounted', () => {
    expect(document.querySelector('textarea')).toBeNull()
    expect(probeComposerCaret('anything')).toBeNull()
  })

  it('returns null when the composer DOM value is out of sync with the store draft', () => {
    mountComposer('hello', 0, 0)
    expect(probeComposerCaret('hello changed on the server')).toBeNull()
  })

  it('returns null for a disabled composer', () => {
    const input = mountComposer('hello', 2, 2)
    input.disabled = true
    expect(probeComposerCaret('hello')).toBeNull()
  })

  it('returns null for a read-only composer', () => {
    const input = mountComposer('hello', 2, 2)
    input.readOnly = true
    expect(probeComposerCaret('hello')).toBeNull()
  })

  it('clamps out-of-range selections into the draft bounds', () => {
    const input = mountComposer('hi', 0, 0)
    // Direct property writes (jsdom does not enforce bounds like browsers).
    input.selectionStart = 5
    input.selectionEnd = 9
    expect(probeComposerCaret('hi')).toEqual({ start: 2, end: 2 })
  })
})

describe('insertAtCaret', () => {
  it('appends at the end when the caret is unknown (pre-fix behavior)', () => {
    expect(insertAtCaret('', 'X', null)).toBe('X')
    expect(insertAtCaret('hello', 'X', null)).toBe('hello X')
    expect(insertAtCaret('   ', 'X', null)).toBe('X')
  })

  it('inserts at the caret in the middle of a sentence with one space each side', () => {
    expect(insertAtCaret('hello world', 'CODE', { start: 5, end: 5 })).toBe('hello CODE world')
  })

  it('only adds the separating spaces the neighbors actually need', () => {
    expect(insertAtCaret('one two', 'CODE', { start: 3, end: 3 })).toBe('one CODE two')
    // Doubled gap, caret right after the word: the leading space is added,
    // the two after the caret stay untouched (like typing in the gap).
    expect(insertAtCaret('one  two', 'CODE', { start: 3, end: 3 })).toBe('one CODE  two')
    // Doubled gap, caret on the second space: neither side needs a new
    // space, both originals flank the insertion.
    expect(insertAtCaret('one  two', 'CODE', { start: 4, end: 4 })).toBe('one CODE two')
    expect(insertAtCaret('one two ', 'CODE', { start: 8, end: 8 })).toBe('one two CODE')
  })

  it('inserts at the start without a leading space', () => {
    expect(insertAtCaret('hello', 'CODE', { start: 0, end: 0 })).toBe('CODE hello')
  })

  it('inserts at the end with a single trailing space', () => {
    expect(insertAtCaret('hello', 'CODE', { start: 5, end: 5 })).toBe('hello CODE')
  })

  it('replaces the live selection', () => {
    expect(insertAtCaret('a little tale', 'CODE', { start: 2, end: 8 })).toBe('a CODE tale')
  })

  it('replaces a selection surrounded by words with single-space joins', () => {
    expect(insertAtCaret('abc def ghi', 'CODE', { start: 4, end: 7 })).toBe('abc CODE ghi')
  })

  it('replaces a selection spanning the whole draft', () => {
    expect(insertAtCaret('old', 'CODE', { start: 0, end: 3 })).toBe('CODE')
  })

  it('handles an empty draft with a resolved caret', () => {
    expect(insertAtCaret('', 'CODE', { start: 0, end: 0 })).toBe('CODE')
  })
})