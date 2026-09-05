/**
 * The Realms tab's mocked governance fixture and its pure vote helpers
 * (src/client/realms-data.ts). Verifies lookups, the active-proposal badge
 * count, and that a vote folds the viewer's power into the optimistic tally.
 */
import { describe, it, expect } from 'vitest'
import {
  MOCK_REALMS, MOCK_PROPOSALS, proposalsOf, realmById, proposalById,
  tallyWith, activeProposalCount,
} from '../src/client/realms-data.ts'

describe('realms-data', () => {
  it('every proposal belongs to a known realm', () => {
    const realmIds = new Set(MOCK_REALMS.map(r => r.id))
    for (const p of MOCK_PROPOSALS) expect(realmIds.has(p.realmId), p.id).toBe(true)
  })

  it('proposalsOf returns only that realm\'s proposals', () => {
    const list = proposalsOf('deepseek-dao')
    expect(list.length).toBeGreaterThan(0)
    expect(list.every(p => p.realmId === 'deepseek-dao')).toBe(true)
  })

  it('lookups resolve and miss cleanly', () => {
    expect(realmById('marinade')?.symbol).toBe('MNDE')
    expect(realmById('nope')).toBeUndefined()
    expect(proposalById('deep-14')?.status).toBe('voting')
    expect(proposalById('nope')).toBeUndefined()
  })

  it('activeProposalCount counts only voting proposals', () => {
    const voting = proposalsOf('deepseek-dao').filter(p => p.status === 'voting').length
    expect(activeProposalCount('deepseek-dao')).toBe(voting)
    expect(activeProposalCount('nope')).toBe(0)
  })

  it('tallyWith folds the viewer power into the chosen side only', () => {
    const p = proposalById('deep-14')!
    const base = tallyWith(p, undefined, 1250)
    expect(base).toEqual({ yes: p.yesVotes, no: p.noVotes, total: p.yesVotes + p.noVotes })

    const yes = tallyWith(p, 'yes', 1250)
    expect(yes.yes).toBe(p.yesVotes + 1250)
    expect(yes.no).toBe(p.noVotes)

    const no = tallyWith(p, 'no', 1250)
    expect(no.no).toBe(p.noVotes + 1250)
    expect(no.yes).toBe(p.yesVotes)
  })

  it('zero voting power leaves the tally unchanged', () => {
    const p = proposalById('deep-14')!
    expect(tallyWith(p, 'yes', 0)).toEqual(tallyWith(p, undefined, 0))
  })
})
