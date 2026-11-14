export type SdkEventType =
  | "session.started"
  | "session.updated"
  | "session.completed"
  | "error";

export interface SdkEventPayloadMap {
  readonly "session.started": { readonly sessionId: string };
  readonly "session.updated": { readonly sessionId: string; readonly status?: string | undefined };
  readonly "session.completed": { readonly sessionId: string; readonly success: boolean };
  readonly error: { readonly message: string };
}

export type SdkEventPayload<T extends SdkEventType> = SdkEventPayloadMap[T];
export type SdkEventHandler<T extends SdkEventType> = (payload: SdkEventPayload<T>) => void;

export interface SdkEventEmitter {
  on<T extends SdkEventType>(event: T, handler: SdkEventHandler<T>): void;
  off<T extends SdkEventType>(event: T, handler: SdkEventHandler<T>): void;
  emit<T extends SdkEventType>(event: T, payload: SdkEventPayload<T>): void;
}

export class BasicSdkEventEmitter implements SdkEventEmitter {
  private readonly handlers: Map<SdkEventType, Set<(payload: unknown) => void>> = new Map();

  on<T extends SdkEventType>(event: T, handler: SdkEventHandler<T>): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (payload: unknown) => void);
    this.handlers.set(event, set);
  }

  off<T extends SdkEventType>(event: T, handler: SdkEventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as (payload: unknown) => void);
  }

  emit<T extends SdkEventType>(event: T, payload: SdkEventPayload<T>): void {
    const set = this.handlers.get(event);
    if (set === undefined) {
      return;
    }
    for (const handler of set) {
      handler(payload);
    }
  }
}

