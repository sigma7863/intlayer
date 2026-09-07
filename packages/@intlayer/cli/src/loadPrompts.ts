/** The `@clack/prompts` module namespace, resolved on demand. */
export type Prompts = typeof import('@clack/prompts');

/**
 * Load the interactive prompt toolkit on demand.
 *
 * `@clack/prompts` must stay out of this package's static import graph:
 * `@clack/core` imports `styleText` from `node:util`, which only exists from
 * Node 20.12. A top-level import therefore fails to even parse the module graph
 * on older runtimes, taking down every *non-interactive* consumer with it —
 * notably the MCP server, which imports the CLI barrel but never prompts.
 *
 * @returns The `@clack/prompts` namespace.
 */
export const loadPrompts = async (): Promise<Prompts> =>
  await import('@clack/prompts');
