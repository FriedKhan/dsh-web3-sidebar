/**
 * The Kanban store (src/client/kanban-data.ts): add / move / claim / remove and
 * the derived board stats that the governance graphs will consume. Runs in
 * memory (the jsdom env stubs localStorage; the store degrades to in-memory).
 */
import { describe, it, expect } from 'vitest'
import { createKanbanStore, COLUMNS } from '../src/client/kanban-data.ts'

const ME = 'Wa11etAddressMe1111111111111111111111111111'

describe('kanban-data store', () => {
  it('seeds a board and reports per-column counts', () => {
    const s = createKanbanStore()
    const total = s.getSnapshot().length
    expect(total).toBeGreaterThan(0)
    const stats = s.stats()
    const summed = COLUMNS.reduce((n, c) => n + stats.perColumn[c.id], 0)
    expect(summed).toBe(total)
  })

  it('add appends a card to the target column', () => {
    const s = createKanbanStore()
    const before = s.stats().perColumn.todo
    s.add({ title: 'New task', column: 'todo', weight: 5 })
    expect(s.stats().perColumn.todo).toBe(before + 1)
    expect(s.getSnapshot().some(t => t.title === 'New task' && t.weight === 5)).toBe(true)
  })

  it('move relocates a card to another column', () => {
    const s = createKanbanStore()
    s.add({ title: 'Mover', column: 'backlog' })
    const id = s.getSnapshot().find(t => t.title === 'Mover')!.id
    s.move(id, 'done')
    expect(s.getSnapshot().find(t => t.id === id)!.column).toBe('done')
  })

  it('completed weight and per-assignee stats accrue only in done', () => {
    const s = createKanbanStore()
    s.add({ title: 'Paid task', column: 'todo', weight: 10, assignee: ME })
    const id = s.getSnapshot().find(t => t.title === 'Paid task')!.id
    const before = s.stats().completedWeight
    s.move(id, 'done')
    const after = s.stats()
    expect(after.completedWeight).toBe(before + 10)
    const mine = after.perAssignee.find(a => a.address === ME)
    expect(mine?.weight).toBe(10)
    expect(mine?.count).toBe(1)
    expect(after.progress).toBeGreaterThan(0)
    expect(after.progress).toBeLessThanOrEqual(1)
  })

  it('claim toggles the assignee; remove deletes the card', () => {
    const s = createKanbanStore()
    s.add({ title: 'Claimable', column: 'todo' })
    const id = s.getSnapshot().find(t => t.title === 'Claimable')!.id
    s.claim(id, ME)
    expect(s.getSnapshot().find(t => t.id === id)!.assignee).toBe(ME)
    s.claim(id, undefined)
    expect(s.getSnapshot().find(t => t.id === id)!.assignee).toBeUndefined()
    s.remove(id)
    expect(s.getSnapshot().some(t => t.id === id)).toBe(false)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const s = createKanbanStore()
    let calls = 0
    const off = s.subscribe(() => { calls += 1 })
    s.add({ title: 'notify' })
    expect(calls).toBeGreaterThan(0)
    const seen = calls
    off()
    s.add({ title: 'silent' })
    expect(calls).toBe(seen)
  })
})
