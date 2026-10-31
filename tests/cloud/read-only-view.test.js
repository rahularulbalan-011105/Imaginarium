import { describe, it, expect, afterEach, vi } from 'vitest'

// CloudProjectManager reaches for Supabase + the stores at import time; none of
// that is needed to decide what KIND of visit this is, so stub the heavy edges.
vi.mock('../../src/lib/supabaseClient.js', () => ({
  getSupabase: async () => null,
  cloudConfigured: () => false,
  SUPABASE_REST: '',
  SUPABASE_APIKEY: '',
}))

const { isCloudMode, isReadOnlyView } = await import('../../src/managers/CloudProjectManager.js')

/** Pretend the editor was opened at this query string. */
function openedAt(search) {
  vi.stubGlobal('window', { location: { search } })
}

afterEach(() => vi.unstubAllGlobals())

// Browsing the community must not ask anyone for an email or an account, and
// the only thing separating "looking" from "building" is the URL the editor was
// opened with. If isReadOnlyView() ever stops recognising one of these shapes,
// EmailGate reappears over a shared link and the community stops being public.
describe('read-only community / share visits', () => {
  it.each([
    ['a community build opened to look at', '?app=1&project=abc&ro=1', true],
    ['a share link', '?app=1&share=sometoken', true],
    ['a share link with no other params', '?share=sometoken', true],
  ])('%s is read-only', (_label, search, expected) => {
    openedAt(search)
    expect(isReadOnlyView()).toBe(expected)
  })

  it.each([
    ['opening your own project to edit', '?app=1&project=abc'],
    ['a plain workshop entry', '?app=1'],
    ['no query at all', ''],
    // ro must be exactly "1" — a stray value is not a licence to skip the gate.
    ['ro with some other value', '?app=1&project=abc&ro=yes'],
  ])('%s is NOT read-only', (_label, search) => {
    openedAt(search)
    expect(isReadOnlyView()).toBe(false)
  })

  it('a reused copy opens editable, so the gate applies again', () => {
    // forkProject makes a new row the user owns; the dashboard opens it with no
    // ro flag, which is what puts the email gate back in front of a builder.
    openedAt('?app=1&project=the-new-copy')
    expect(isReadOnlyView()).toBe(false)
    expect(isCloudMode()).toBe(true)
  })

  it('is independent of cloud mode: a share link is both', () => {
    openedAt('?share=sometoken')
    expect(isCloudMode()).toBe(true)
    expect(isReadOnlyView()).toBe(true)
  })
})
