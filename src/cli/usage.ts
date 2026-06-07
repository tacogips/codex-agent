export const CLI_NAME = "codex-agent";

export const USAGE = `${CLI_NAME} - Codex session manager

Usage:
  ${CLI_NAME} session list [options]
  ${CLI_NAME} session show <id> [--tasks]
  ${CLI_NAME} session watch <id>
  ${CLI_NAME} session run --prompt <P> [options]
  ${CLI_NAME} session resume <id> [options]
  ${CLI_NAME} session fork <id> [--nth-message N] [options]

  ${CLI_NAME} group create <name> [--description D]
  ${CLI_NAME} group list [--format json|table]
  ${CLI_NAME} group show <group>
  ${CLI_NAME} group add <group> <session>
  ${CLI_NAME} group remove <group> <session>
  ${CLI_NAME} group pause <group>
  ${CLI_NAME} group resume <group>
  ${CLI_NAME} group delete <group>
  ${CLI_NAME} group run <name> --prompt <P> [--max-concurrent N] [--image FILE]...

  ${CLI_NAME} bookmark add --type <session|message|range> --session <id> --name <name> [options]
  ${CLI_NAME} bookmark list [--format json|table] [--session <id>] [--type <type>] [--tag <tag>]
  ${CLI_NAME} bookmark get <id>
  ${CLI_NAME} bookmark delete <id>
  ${CLI_NAME} bookmark search <query> [--limit <n>] [--format json|table]

  ${CLI_NAME} token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]
  ${CLI_NAME} token list [--format json|table]
  ${CLI_NAME} token revoke <id>
  ${CLI_NAME} token rotate <id>

  ${CLI_NAME} files list <session-id> [--format json|table]
  ${CLI_NAME} files patches <session-id> [--format json|table]
  ${CLI_NAME} files find <path> [--format json|table]
  ${CLI_NAME} files rebuild

  ${CLI_NAME} queue create <name> --project <path>
  ${CLI_NAME} queue add <name> --prompt <prompt> [--image FILE]...
  ${CLI_NAME} queue show <name>
  ${CLI_NAME} queue list [--format json|table]
  ${CLI_NAME} queue pause <name>
  ${CLI_NAME} queue resume <name>
  ${CLI_NAME} queue delete <name>
  ${CLI_NAME} queue update <name> <command-id> [--prompt <text>] [--status <status>]
  ${CLI_NAME} queue remove <name> <command-id>
  ${CLI_NAME} queue move <name> --from <n> --to <n>
  ${CLI_NAME} queue mode <name> <command-id> --mode <auto|manual>
  ${CLI_NAME} queue run <name> [--image FILE]...

  ${CLI_NAME} model check --model <model> [--json] [--timeout-ms <ms>]

  ${CLI_NAME} graphql <query|command> [--param <json|path>] [--variables <json|path>]

  ${CLI_NAME} version [--json] [--include-git]

Session list options:
  --source <cli|vscode|exec>  Filter by session source
  --cwd <path>                Filter by working directory
  --branch <name>             Filter by git branch
  --limit <n>                 Max results (default: 50)
  --format <table|json>       Output format (default: table)

Common process options:
  --model <model>             Model to use
  --sandbox <read-only|workspace-write|danger-full-access>  Sandbox mode
  --approval-mode <mode>       Deprecated no-op for Codex CLI 0.137+
  --full-auto                 Enable Codex CLI bypass mode
  --stream-granularity <event|char>  Stream by rollout event or character
  --char-delay-ms <n>         Delay per rendered char in ms (session run only, default: 8)
  --image <path>              Attach image(s) to prompt (repeatable)

`;
