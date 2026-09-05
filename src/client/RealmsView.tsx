/**
 * The Realms (SPL Governance) tab: browse governance realms, their proposals,
 * and cast a mock vote. UI-first (M3) — the data is the deterministic fixture
 * in realms-data.ts and a vote updates local state optimistically; the real
 * `@solana/spl-governance` RPC wiring is later work. The signed-in wallet's
 * address is the voter identity, and its per-realm voting power drives the
 * optimistic tally.
 */
import { useState, type ReactNode } from 'react'
import css from './RealmsView.module.css'
import { t, type CopyKey } from './locales.ts'
import { shortAddress, useWallet, type WalletStore } from './wallet.ts'
import {
  MOCK_REALMS, activeProposalCount, proposalsOf, realmById, tallyWith,
  type Proposal, type ProposalStatus, type VoteChoice,
} from './realms-data.ts'

/** Governance glyph (tab icon + header). */
export function RealmsTabIcon({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M5 21V10l7-6 7 6v11" />
      <path d="M9 21v-6h6v6" />
    </svg>
  )
}

function IconChevron(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function IconBack(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

const STATUS_KEY: Record<ProposalStatus, CopyKey> = {
  voting: 'realmsStatusVoting',
  succeeded: 'realmsStatusSucceeded',
  defeated: 'realmsStatusDefeated',
  executing: 'realmsStatusExecuting',
}

/** A status pill; the class carries the state colour. */
function StatusBadge({ status }: { status: ProposalStatus }): ReactNode {
  return <span className={`${css.status} ${css[`status_${status}`] ?? ''}`}>{t(STATUS_KEY[status])}</span>
}

/** Compact token-weight formatting (12.4M / 182.4K / 950). */
function formatWeight(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`
  if (value >= 1_000) return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
  return value.toLocaleString()
}

/** The yes/no progress bar for a proposal's current tally. */
function VoteBar({ yes, no }: { yes: number; no: number }): ReactNode {
  const total = yes + no
  // With no votes yet, leave the track empty (neutral) rather than painting it
  // fully "No" red — both widths stay 0 so the bar background shows through.
  const yesPct = total === 0 ? 0 : Math.round((yes / total) * 100)
  const noPct = total === 0 ? 0 : 100 - yesPct
  return (
    <div className={css.bar}>
      <div className={css.barYes} style={{ width: `${yesPct}%` }} />
      <div className={css.barNo} style={{ width: `${noPct}%` }} />
    </div>
  )
}

export function RealmsView({ wallet }: { wallet: WalletStore }): ReactNode {
  const snap = useWallet(wallet)
  const voter = snap.account?.address
  const [realmId, setRealmId] = useState<string | null>(null)
  const [proposalId, setProposalId] = useState<string | null>(null)
  // Local optimistic votes: proposalId → the viewer's choice.
  const [votes, setVotes] = useState<Record<string, VoteChoice>>({})

  const realm = realmId !== null ? realmById(realmId) : undefined
  const proposal = proposalId !== null ? proposalsOf(realmId ?? '').find(p => p.id === proposalId) : undefined

  // ── Level 3: proposal detail ──────────────────────────────────────────
  if (realm !== undefined && proposal !== undefined) {
    const myVote = votes[proposal.id]
    const votePower = realm.myVotePower
    const tally = tallyWith(proposal, myVote, votePower)
    const passing = tally.yes >= proposal.quorum
    const canVote = proposal.status === 'voting' && votePower > 0 && voter !== undefined
    const cast = (choice: VoteChoice): void => setVotes(prev => ({ ...prev, [proposal.id]: choice }))

    return (
      <div className={css.realms}>
        <button type="button" className={css.backRow} onClick={() => setProposalId(null)}>
          <IconBack /> {realm.name}
        </button>
        <div className={css.card}>
          <div className={css.detailHead}>
            <StatusBadge status={proposal.status} />
            <span className={css.proposalId}>#{proposal.id}</span>
          </div>
          <h2 className={css.detailTitle}>{proposal.title}</h2>
          <p className={css.detailDesc}>{proposal.description}</p>
          <div className={css.tallyRow}>
            <span className={css.tallyYes}>{t('realmsYes')} {formatWeight(tally.yes)}</span>
            <span className={css.tallyNo}>{t('realmsNo')} {formatWeight(tally.no)}</span>
          </div>
          <VoteBar yes={tally.yes} no={tally.no} />
          <div className={css.quorum}>
            {t('realmsQuorum', { pct: proposal.quorum === 0 ? 100 : Math.min(100, Math.round((tally.yes / proposal.quorum) * 100)) })}
            {proposal.status === 'voting' ? ` · ${t('realmsEndsIn', { hours: proposal.endsInHours })}` : ''}
            {proposal.status === 'voting' ? ` · ${passing ? t('realmsPassing') : t('realmsFailing')}` : ''}
          </div>
        </div>

        <div className={css.card}>
          {myVote !== undefined ? (
            <div className={css.voted}>
              {t('realmsYouVoted', { choice: myVote === 'yes' ? t('realmsYes') : t('realmsNo') })}
              {' · '}{formatWeight(votePower)} {realm.symbol}
              <button type="button" className={css.link} onClick={() => setVotes(prev => { const next = { ...prev }; delete next[proposal.id]; return next })}>
                {t('realmsChangeVote')}
              </button>
            </div>
          ) : canVote ? (
            <>
              <div className={css.voteLabel}>{t('realmsCastVote', { power: formatWeight(votePower), symbol: realm.symbol })}</div>
              <div className={css.voteButtons}>
                <button type="button" className={css.voteYes} onClick={() => cast('yes')}>{t('realmsVoteYes')}</button>
                <button type="button" className={css.voteNo} onClick={() => cast('no')}>{t('realmsVoteNo')}</button>
              </div>
            </>
          ) : (
            <div className={css.note}>
              {proposal.status !== 'voting'
                ? t('realmsVotingClosed')
                : votePower <= 0
                  ? t('realmsNoPower', { realm: realm.name })
                  : t('realmsConnectToVote')}
            </div>
          )}
        </div>
        <div className={css.previewNote}>{t('realmsPreviewNote')}</div>
      </div>
    )
  }

  // ── Level 2: a realm's proposals ──────────────────────────────────────
  if (realm !== undefined) {
    const proposals = proposalsOf(realm.id)
    return (
      <div className={css.realms}>
        <button type="button" className={css.backRow} onClick={() => setRealmId(null)}>
          <IconBack /> {t('realmsAll')}
        </button>
        <div className={css.realmHeader}>
          <div className={css.realmMark}>{realm.symbol.slice(0, 2)}</div>
          <div>
            <div className={css.realmName}>{realm.name}</div>
            <div className={css.realmMeta}>{t('realmsMembers', { count: realm.members.toLocaleString() })} · {t('realmsYourPower', { power: formatWeight(realm.myVotePower), symbol: realm.symbol })}</div>
          </div>
        </div>
        <div className={css.list}>
          {proposals.map(p => (
            <ProposalRow key={p.id} proposal={p} voted={votes[p.id]} realmVotePower={realm.myVotePower} onOpen={() => setProposalId(p.id)} />
          ))}
        </div>
        <div className={css.previewNote}>{t('realmsPreviewNote')}</div>
      </div>
    )
  }

  // ── Level 1: realms list ──────────────────────────────────────────────
  return (
    <div className={css.realms}>
      <div className={css.header}>
        <span className={css.headerMark}><RealmsTabIcon size={18} /></span>
        <div>
          <div className={css.headerTitle}>{t('realmsTitle')}</div>
          <div className={css.headerSub}>{voter !== undefined ? shortAddress(voter) : t('realmsNoWallet')}</div>
        </div>
      </div>
      <div className={css.list}>
        {MOCK_REALMS.map(r => (
          <button key={r.id} type="button" className={css.realmRow} onClick={() => setRealmId(r.id)}>
            <span className={css.realmMark}>{r.symbol.slice(0, 2)}</span>
            <span className={css.realmRowText}>
              <span className={css.realmName}>{r.name}</span>
              <span className={css.realmMeta}>{t('realmsMembers', { count: r.members.toLocaleString() })}</span>
            </span>
            {activeProposalCount(r.id) > 0 && <span className={css.activePill}>{t('realmsActive', { count: activeProposalCount(r.id) })}</span>}
            <span className={css.chevron}><IconChevron /></span>
          </button>
        ))}
      </div>
      <div className={css.previewNote}>{t('realmsPreviewNote')}</div>
    </div>
  )
}

/** One proposal row in a realm's list. */
function ProposalRow({ proposal, voted, realmVotePower, onOpen }: { proposal: Proposal; voted: VoteChoice | undefined; realmVotePower: number; onOpen: () => void }): ReactNode {
  const tally = tallyWith(proposal, voted, realmVotePower)
  return (
    <button type="button" className={css.proposalRow} onClick={onOpen}>
      <div className={css.proposalTop}>
        <StatusBadge status={proposal.status} />
        {voted !== undefined && <span className={css.votedPill}>{t('realmsVotedPill')}</span>}
      </div>
      <div className={css.proposalTitle}>{proposal.title}</div>
      <VoteBar yes={tally.yes} no={tally.no} />
    </button>
  )
}
