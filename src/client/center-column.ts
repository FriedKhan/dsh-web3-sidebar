/** Stable selector for the DSH AppFrame conversation slot. */
const CENTER_COLUMN_SELECTOR = '#root [data-slot="conversation"]'

/**
 * Resolve the AppFrame center column while keeping the hot path query-free.
 *
 * Streaming chat output mutates `#root` at token cadence, so Sidebar's
 * MutationObserver can call this once per animation frame. Once the center
 * column has been found, its DOM identity is stable for the conversation
 * lifecycle; checking `isConnected` is enough to reuse it without scanning
 * the whole app tree again. Boot/HMR replacement still falls through to the
 * document query as soon as the cached node is detached.
 */
export function resolveCenterColumn(
  current: HTMLElement | null,
  query: () => Element | null = () => document.querySelector(CENTER_COLUMN_SELECTOR),
): HTMLElement | undefined {
  if (current !== null && current.isConnected) return current

  const col = query()?.parentElement
  return col !== null && col !== undefined && col.isConnected ? col : undefined
}
