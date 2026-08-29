// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCenterColumn } from '../src/client/center-column.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

function connectedColumn(): { col: HTMLDivElement; slot: HTMLDivElement } {
  const col = document.createElement('div')
  const slot = document.createElement('div')
  slot.dataset.slot = 'conversation'
  col.append(slot)
  document.body.append(col)
  return { col, slot }
}

describe('center-column locator (issue #403)', () => {
  it('reuses a connected cached column without querying the app tree', () => {
    const { col } = connectedColumn()
    const query = vi.fn<() => Element | null>(() => null)

    expect(resolveCenterColumn(col, query)).toBe(col)
    expect(query).not.toHaveBeenCalled()
  })

  it('queries and adopts the replacement after the cached column detaches', () => {
    const stale = connectedColumn().col
    stale.remove()
    const { col: replacement, slot } = connectedColumn()
    const query = vi.fn<() => Element | null>(() => slot)

    expect(resolveCenterColumn(stale, query)).toBe(replacement)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('queries when no column has been cached yet', () => {
    const { col, slot } = connectedColumn()
    const query = vi.fn<() => Element | null>(() => slot)

    expect(resolveCenterColumn(null, query)).toBe(col)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing or detached query result', () => {
    expect(resolveCenterColumn(null, () => null)).toBeUndefined()

    const detachedCol = document.createElement('div')
    const detachedSlot = document.createElement('div')
    detachedCol.append(detachedSlot)
    expect(resolveCenterColumn(null, () => detachedSlot)).toBeUndefined()
  })
})
