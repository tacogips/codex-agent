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

import { handleBookmark } from "./commands/bookmark";
import { handleFiles } from "./commands/files";
import { handleGroup } from "./commands/group";
import { handleQueue } from "./commands/queue";
import { handleSession } from "./commands/session";
import { handleToken } from "./commands/token";
import { runGraphqlCli } from "./graphql";
import { USAGE } from "./usage";
import { handleModel, handleVersion } from "./version-model";

export type { ModelCheckArgs } from "./version-model";
export { parseModelCheckArgs, parseVersionArgs } from "./version-model";
export { parseProcessOptions } from "./parsing";

export async function run(argv: readonly string[]): Promise<void> {
  const args = argv.slice(2); // skip node and script path

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    return;
  }

  const subcommand = args[0];
  const action = args[1];
  const rest = args.slice(2);

  switch (subcommand) {
    case "session":
      await handleSession(action, rest);
      break;
    case "group":
      await handleGroup(action, rest);
      break;
    case "queue":
      await handleQueue(action, rest);
      break;
    case "bookmark":
      await handleBookmark(action, rest);
      break;
    case "token":
      await handleToken(action, rest);
      break;
    case "files":
      await handleFiles(action, rest);
      break;
    case "model":
      await handleModel(action, rest);
      break;
    case "version":
      await handleVersion(args.slice(1));
      break;
    case "graphql":
      await runGraphqlCli(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${subcommand}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
