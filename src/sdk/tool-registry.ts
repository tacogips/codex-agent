export interface ToolContext {
  readonly sessionId?: string | undefined;
}

export interface ToolConfig<TInput, TOutput> {
  readonly name: string;
  readonly description?: string | undefined;
  readonly run: (input: TInput, context?: ToolContext) => Promise<TOutput> | TOutput;
}

export interface RegisteredTool<TInput, TOutput> {
  readonly name: string;
  readonly description?: string | undefined;
  run(input: TInput, context?: ToolContext): Promise<TOutput>;
}

export function tool<TInput, TOutput>(
  config: ToolConfig<TInput, TOutput>,
): RegisteredTool<TInput, TOutput> {
  if (config.name.trim().length === 0) {
    throw new Error("tool name is required");
  }
  return {
    name: config.name,
    description: config.description,
    async run(input: TInput, context?: ToolContext): Promise<TOutput> {
      return await config.run(input, context);
    },
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool<unknown, unknown>>();

  register<TInput, TOutput>(registeredTool: RegisteredTool<TInput, TOutput>): void {
    this.tools.set(registeredTool.name, registeredTool as RegisteredTool<unknown, unknown>);
  }

  get<TInput, TOutput>(name: string): RegisteredTool<TInput, TOutput> | null {
    const value = this.tools.get(name);
    if (value === undefined) {
      return null;
    }
    return value as RegisteredTool<TInput, TOutput>;
  }

  list(): readonly string[] {
    return Array.from(this.tools.keys()).sort();
  }

  async run<TInput, TOutput>(
    name: string,
    input: TInput,
    context?: ToolContext,
  ): Promise<TOutput> {
    const registered = this.get<TInput, TOutput>(name);
    if (registered === null) {
      throw new Error(`tool not found: ${name}`);
    }
    return registered.run(input, context);
  }
}

