/**
 * The unified changes tab shell: the lens switcher swaps the Git lens for
 * the session lens, and a Git-lens file row opens the shared preview pane
 * (loaded through the mocked git API, rendered by the shared DiffFiles
 * stack) instead of minting a diff tab directly.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ChangesTab } from '../src/client/changes/ChangesTab.tsx'
import { createSidebarStore } from '../src/client/state.ts'
import { api, type GitStatusResult, type GitWorktree } from '../src/client/api.ts'
import type { Context } from '../src/context-types.ts'
import type { SidebarTab } from '../src/client/state.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MAIN = 'C:/repo/main'

function fakeContext(): Context {
  return {
    sessions: { get: () => undefined },
    get: () => undefined,
    on: () => () => { /* no-op */ },
  } as unknown as Context
}

function mount(root: Root): void {
  const tab: SidebarTab = { id: 'git', type: 'git', title: 'Changes' }
  act(() => {
    root.render(createElement(ChangesTab, {
      ctx: fakeContext(),
      store: createSidebarStore(),
      scope: { sessionId: 'session', cwd: MAIN },
      tab,
      visible: false,
      onOpenFile: () => {},
      onOpenDiff: () => {},
    }))
  })
}

function mockGit(entries: Array<{ path: string; xy: string }>): void {
  vi.spyOn(api, 'gitWorktrees').mockResolvedValue([
    { path: MAIN, branch: 'main', current: true, changes: entries.length },
  ] as GitWorktree[])
  vi.spyOn(api, 'gitStatus').mockResolvedValue({
    isRepo: true, branch: 'main', entries,
  } as GitStatusResult)
  vi.spyOn(api, 'gitBranch').mockResolvedValue({ current: 'main', names: ['main'] })
  vi.spyOn(api, 'gitLog').mockResolvedValue([])
}

async function flushEffects(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ChangesTab', () => {
  it('renders the git lens by default and previews a file row in the pane', async () => {
    mockGit([{ path: 'src/a.ts', xy: ' M' }])
    vi.spyOn(api, 'gitDiff').mockResolvedValue({
      diff: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
    })

    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    try {
      mount(root)
      await flushEffects()

      // Git lens: the file row from the mocked status (badge letter + path).
      const row = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('src/a.ts'))
      expect(row).toBeDefined()

      // Clicking the row previews inline (no diff tab minted): the shared
      // renderer draws the added row.
      await act(async () => { row!.click() })
      await flushEffects()
      expect(container.textContent).toContain('new')

      // The preview survives a lens switch (it is a dock, not lens state).
      const group = container.querySelector('[role="group"]')
      const sessionButton = [...group!.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.getAttribute('aria-pressed') === 'false')
      expect(sessionButton).toBeDefined()
      await act(async () => { sessionButton!.click() })
      expect(container.textContent).toContain('src/a.ts')
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })

  it('switches to the session lens, which shows its empty state without ops', async () => {
    mockGit([])
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    try {
      mount(root)
      await flushEffects()
      const group = container.querySelector('[role="group"]')
      expect(group).not.toBeNull()
      const buttons = [...group!.querySelectorAll<HTMLButtonElement>('button')]
      await act(async () => { buttons[1]!.click() })
      // No session events in the fake context: the session lens empty state
      // (locale-agnostic — the test env may resolve zh or en).
      expect(container.textContent).toMatch(/本会话还没有文件操作|No file operations/)
      // The git lens (its branch picker) is unmounted by the switch.
      expect(container.querySelector('select')).toBeNull()
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })
})
