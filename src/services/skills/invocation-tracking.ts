/**
 * Track which skills have been invoked to prevent re-injection of
 * already-used skills in system-reminder listings.
 *
 * The set is global per process — in the main agent there is a single
 * set; subagents get their own process. This is intentional: once a
 * skill has been invoked, the model has its content and doesn't need
 * the system-reminder entry any more.
 */

const invokedSkills = new Set<string>()

export function addInvokedSkill(name: string): void {
  invokedSkills.add(name.toLowerCase())
}

export function hasSkillBeenInvoked(name: string): boolean {
  return invokedSkills.has(name.toLowerCase())
}

export function clearInvokedSkills(): void {
  invokedSkills.clear()
}
