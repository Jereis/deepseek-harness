/** Shared provider display order for the composer and command model pickers. */

/** Providers listed first when no plugin contributes a priority. */
export const DEFAULT_PROVIDER_PRIORITY: readonly string[] = ['deepseek-account', 'deepseek-official']

/**
 * Put the listed providers first in list order, preserving every other relative order.
 * @param groups - Provider groups in catalog order.
 * @param priority - Provider ids to list first; defaults to {@link DEFAULT_PROVIDER_PRIORITY}.
 * @returns a sorted copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(
  groups: readonly T[],
  priority: readonly string[] = DEFAULT_PROVIDER_PRIORITY,
): T[] {
  const rank = (id: string): number => {
    const index = priority.indexOf(id)
    return index === -1 ? priority.length : index
  }
  return groups.toSorted((left, right) => rank(left.id) - rank(right.id))
}
