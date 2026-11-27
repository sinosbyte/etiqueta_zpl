import type { Me } from './accountClient';
import type { DesignSummary } from './designsClient';

// My designs (Etapa 4, 27/11/2026): who may delete a design, and the name of a copy.

/**
 * The server lets delete a design only whoever created it or an administrator of the company; the button follows the
 * same rule, so nobody is offered what would be refused. Unknown creator: only an administrator.
 */
export function canDeleteDesign(me: Pick<Me, 'userId' | 'role'> | null, design: Pick<DesignSummary, 'createdBy'>): boolean {
  if (!me) return false;
  if (me.role === 'company_admin' || me.role === 'platform_admin') return true;
  return design.createdBy?.id === me.userId;
}

const MAX_NAME = 100;   // the server's limit for a design name

/**
 * The name of a copy: "Name (cópia)", then "Name (cópia 2)", … for the attempt `n` (names are unique in the company).
 * A long name is shortened so the whole fits in the server's limit.
 */
export function copyName(name: string, n: number, word: string): string {
  const suffix = n <= 1 ? ` (${word})` : ` (${word} ${n})`;
  const base = name.trim().slice(0, MAX_NAME - suffix.length).trimEnd();
  return base + suffix;
}
