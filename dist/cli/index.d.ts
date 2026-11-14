/**
 * CLI entry point for codex-agent.
 *
 * Subcommands:
 *   session list [--source S] [--cwd P] [--branch B] [--format json|table]
 *   session show <id> [--tasks]
 *   session watch <id>
 *   session run --prompt <P> [--model M] [--sandbox S] [--full-auto] [--stream-granularity event|char]
 *   session resume <id> [--model M] [--sandbox S] [--full-auto]
 *   session fork <id> [--nth-message N] [--model M] [--sandbox S] [--full-auto]
 *
 *   group create <name> [--description D]
 *   group list [--format json|table]
 *   group show <group>
 *   group add <group> <session>
 *   group remove <group> <session>
 *   group pause <group>
 *   group resume <group>
 *   group delete <group>
 *   group run <name> --prompt <P> [--max-concurrent N] [--model M] [--image FILE]...
 *
 *   bookmark add --type <session|message|range> --session <id> --name <name> [options]
 *   bookmark list [--format json|table] [--session <id>] [--type <type>] [--tag <tag>]
 *   bookmark get <id>
 *   bookmark delete <id>
 *   bookmark search <query> [--limit <n>] [--format json|table]
 *
 *   token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]
 *   token list [--format json|table]
 *   token revoke <id>
 *   token rotate <id>
 *
 *   files list <session-id> [--format json|table]
 *   files patches <session-id> [--format json|table]
 *   files find <path> [--format json|table]
 *   files rebuild
 *
 *   queue create <name> --project <path>
 *   queue add <name> --prompt <prompt> [--image FILE]...
 *   queue show <name>
 *   queue list [--format json|table]
 *   queue pause <name>
 *   queue resume <name>
 *   queue delete <name>
 *   queue update <name> <command-id> [--prompt <text>] [--status <status>]
 *   queue remove <name> <command-id>
 *   queue move <name> --from <n> --to <n>
 *   queue mode <name> <command-id> --mode <auto|manual>
 *   queue run <name> [--model M] [--sandbox S] [--full-auto] [--image FILE]...
 *
 *   model check --model <model> [--json] [--timeout-ms <ms>]
 *
 *   graphql <query|command> [--param <json|path>] [--variables <json|path>]
 *
 *   version [--json] [--include-git]
 */
export type { ModelCheckArgs } from "./version-model";
export { parseModelCheckArgs, parseVersionArgs } from "./version-model";
export { parseProcessOptions } from "./parsing";
export declare function run(argv: readonly string[]): Promise<void>;
//# sourceMappingURL=index.d.ts.map