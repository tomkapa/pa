import { describe, test, expect } from 'bun:test'
import { getTeammateModeSection } from '../services/system-prompt/dynamic-sections.js'
import { TEAM_LEADER_NAME } from '../services/teams/types.js'

describe('getTeammateModeSection', () => {
  test('returns null when identity is null (leader session)', () => {
    expect(getTeammateModeSection(null)).toBeNull()
  })

  test('returns role + hand-off directive for teammates', () => {
    const section = getTeammateModeSection({
      agentId: 'scribe@alpha',
      agentName: 'scribe',
      teamName: 'alpha',
    })
    expect(section).not.toBeNull()
    expect(section).toContain('Teammate Mode')
    expect(section).toContain('`scribe`')
    expect(section).toContain('`alpha`')
    expect(section).toContain(TEAM_LEADER_NAME)

    // The hand-off rule is the point of this section — enforce structure,
    // not just presence of keywords. Tests guard against the rule softening
    // into optional language or flipping polarity.
    expect(section).toMatch(/FINAL action[\s\S]*MUST be[\s\S]*SendMessage\(to: "team-lead"/)
    expect(section).not.toMatch(/\boptional(ly)?\b/i)
    expect(section).not.toMatch(/\bmay\b.*SendMessage/i)
  })
})
