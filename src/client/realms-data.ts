/**
 * Mocked Solana Realms (SPL Governance) data for the Realms tab (M3, UI-first).
 *
 * This is a deterministic in-memory fixture — no network, no `@solana/spl-
 * governance`, no real on-chain reads. It exists so the governance UI (realms →
 * proposals → vote) is complete and clickable before the real RPC integration.
 * The vote helpers are pure so the tab can show an optimistic tally the moment
 * a vote is cast. When the real integration lands it replaces this module
 * behind the same `Realm` / `Proposal` types.
 */

/** A governance realm (a DAO). */
export interface Realm {
  readonly id: string
  readonly name: string
  /** Governance token symbol (e.g. 'DEEP'). */
  readonly symbol: string
  /** Fake community mint address (display only). */
  readonly communityMint: string
  readonly members: number
  /** The signed-in wallet's mock voting power in this realm (token units). */
  readonly myVotePower: number
}

/** A proposal's lifecycle state. */
export type ProposalStatus = 'voting' | 'succeeded' | 'defeated' | 'executing'

/** One governance proposal. */
export interface Proposal {
  readonly id: string
  readonly realmId: string
  readonly title: string
  readonly description: string
  readonly status: ProposalStatus
  /** Yes/No weight already tallied (token units), excluding the viewer's vote. */
  readonly yesVotes: number
  readonly noVotes: number
  /** Yes-weight needed to pass. */
  readonly quorum: number
  /** Hours left while `status === 'voting'` (display only). */
  readonly endsInHours: number
  /** Proposer wallet (display only). */
  readonly proposer: string
}

/** A cast vote. */
export type VoteChoice = 'yes' | 'no'

/** The mocked realms the signed-in wallet can see. */
export const MOCK_REALMS: readonly Realm[] = [
  { id: 'deepseek-dao', name: 'DeepSeek DAO', symbol: 'DEEP', communityMint: 'Deep5eekDAoMint1111111111111111111111111111', members: 4821, myVotePower: 1250 },
  { id: 'marinade', name: 'Marinade', symbol: 'MNDE', communityMint: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', members: 12904, myVotePower: 320 },
  { id: 'mango-dao', name: 'Mango DAO', symbol: 'MNGO', communityMint: 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac', members: 8760, myVotePower: 0 },
  { id: 'grape', name: 'Grape', symbol: 'GRAPE', communityMint: 'GRAPEqL4rWMN7BsHkqT6TFP5sLNKqUmoVtBpmtBBQr5', members: 2043, myVotePower: 75 },
]

/** The mocked proposals, keyed to their realm. */
export const MOCK_PROPOSALS: readonly Proposal[] = [
  {
    id: 'deep-14', realmId: 'deepseek-dao', title: 'Fund the plugin ecosystem grants (Q3)',
    description: 'Allocate 250,000 DEEP from the treasury to a grants program for third-party sidebar plugins and skills, disbursed over two quarters against public milestones.',
    status: 'voting', yesVotes: 182_400, noVotes: 41_900, quorum: 200_000, endsInHours: 39, proposer: 'DeepGov1nitiator1111111111111111111111111111',
  },
  {
    id: 'deep-13', realmId: 'deepseek-dao', title: 'Enable on-chain identity for wallet login',
    description: 'Adopt Sign-In-With-Solana across the harness so a wallet is a first-class identity for gating and attribution.',
    status: 'succeeded', yesVotes: 341_000, noVotes: 22_100, quorum: 200_000, endsInHours: 0, proposer: 'DeepGov1nitiator1111111111111111111111111111',
  },
  {
    id: 'deep-12', realmId: 'deepseek-dao', title: 'Reduce proposal deposit to 100 DEEP',
    description: 'Lower the barrier to submitting proposals from 500 DEEP to 100 DEEP to widen participation.',
    status: 'defeated', yesVotes: 88_000, noVotes: 151_500, quorum: 200_000, endsInHours: 0, proposer: 'Grape5ubmitter11111111111111111111111111111',
  },
  {
    id: 'mnde-51', realmId: 'marinade', title: 'Direct 5% of staking rewards to an insurance fund',
    description: 'Route a slice of validator rewards into a protocol-owned insurance fund to backstop slashing events.',
    status: 'voting', yesVotes: 9_120_000, noVotes: 3_400_000, quorum: 10_000_000, endsInHours: 62, proposer: 'MarinadeCoreTeam11111111111111111111111111',
  },
  {
    id: 'mnde-50', realmId: 'marinade', title: 'Add two community validators to the delegation set',
    description: 'Onboard two performance-audited community validators, each capped at 0.5% of delegated stake.',
    status: 'executing', yesVotes: 14_200_000, noVotes: 900_000, quorum: 10_000_000, endsInHours: 0, proposer: 'MarinadeCoreTeam11111111111111111111111111',
  },
  {
    id: 'mngo-77', realmId: 'mango-dao', title: 'Re-list SOL-PERP with updated risk parameters',
    description: 'Restore the SOL perpetual market with lower max leverage and a wider insurance buffer after the risk review.',
    status: 'voting', yesVotes: 41_000_000, noVotes: 12_500_000, quorum: 60_000_000, endsInHours: 15, proposer: 'MangoRiskCouncil111111111111111111111111111',
  },
  {
    id: 'grape-09', realmId: 'grape', title: 'Sponsor a Solana hacker house in Lisbon',
    description: 'Commit 40,000 GRAPE to co-host a one-week builder residency, with sponsorship reporting back to the DAO.',
    status: 'voting', yesVotes: 210_000, noVotes: 96_000, quorum: 250_000, endsInHours: 88, proposer: 'GrapeCommunity11111111111111111111111111111',
  },
]

/** The proposals of one realm, newest id first. */
export function proposalsOf(realmId: string): Proposal[] {
  return MOCK_PROPOSALS.filter(p => p.realmId === realmId)
}

/** A realm by id. */
export function realmById(id: string): Realm | undefined {
  return MOCK_REALMS.find(r => r.id === id)
}

/** A proposal by id. */
export function proposalById(id: string): Proposal | undefined {
  return MOCK_PROPOSALS.find(p => p.id === id)
}

/** The yes/no tally including the viewer's own vote, given their voting power.
 *  Pure — the tab derives the displayed bar from this so a fresh vote shows
 *  immediately (optimistic), without mutating the fixture. */
export function tallyWith(proposal: Proposal, vote: VoteChoice | undefined, votePower: number): { yes: number; no: number; total: number } {
  const yes = proposal.yesVotes + (vote === 'yes' ? votePower : 0)
  const no = proposal.noVotes + (vote === 'no' ? votePower : 0)
  return { yes, no, total: yes + no }
}

/** Count of proposals currently in the voting state for a realm (badge). */
export function activeProposalCount(realmId: string): number {
  return proposalsOf(realmId).filter(p => p.status === 'voting').length
}
