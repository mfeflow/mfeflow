/** Runs `step` on each item one after another. File writes and rollbacks depend on the order. */
export async function inOrder<T>(
  items: readonly T[],
  step: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    // oxlint-disable-next-line no-await-in-loop
    await step(item);
  }
}
