/**
 * Server types for the HTTP daemon.
 */

export interface ServerConfig {
  readonly port: number;
  readonly hostname: string;
  readonly token?: string | undefined;
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
  readonly transport: "local-cli" | "app-server";
  readonly appServerUrl?: string | undefined;
}

export interface RouteParams {
  readonly [key: string]: string;
}

export type RouteHandler = (
  req: Request,
  params: RouteParams,
  config: ServerConfig,
) => Promise<Response> | Response;

export interface ServerHandle {
  readonly port: number;
  readonly hostname: string;
  readonly startedAt: Date;
  stop(): void;
}

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TRANSPORT: ServerConfig["transport"] = "local-cli";

export function resolveServerConfig(
  overrides?: Partial<ServerConfig>,
): ServerConfig {
  const env = typeof process !== "undefined" ? process.env : {};
  const port =
    overrides?.port ??
    (env["CODEX_AGENT_PORT"] !== undefined
      ? parseInt(env["CODEX_AGENT_PORT"], 10)
      : DEFAULT_PORT);
  const hostname =
    overrides?.hostname ?? env["CODEX_AGENT_HOST"] ?? DEFAULT_HOST;
  const token = overrides?.token ?? env["CODEX_AGENT_TOKEN"];
  const transport = (() => {
    const raw = overrides?.transport ?? env["CODEX_AGENT_TRANSPORT"];
    if (raw === "app-server" || raw === "local-cli") {
      return raw;
    }
    return DEFAULT_TRANSPORT;
  })();
  const appServerUrl =
    overrides?.appServerUrl ?? env["CODEX_AGENT_APP_SERVER_URL"];
  if (transport === "app-server" && (appServerUrl === undefined || appServerUrl === "")) {
    throw new Error("app-server transport requires appServerUrl");
  }
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    hostname,
    token: token !== undefined && token !== "" ? token : undefined,
    codexHome: overrides?.codexHome,
    configDir: overrides?.configDir,
    transport,
    appServerUrl:
      appServerUrl !== undefined && appServerUrl !== ""
        ? appServerUrl
        : undefined,
  };
}
