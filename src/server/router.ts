/**
 * Minimal HTTP router with path parameter support.
 *
 * Pattern `/api/sessions/:id` matches `/api/sessions/abc123`
 * and captures `{ id: "abc123" }`.
 */

import type { Permission } from "../auth/index";
import type { RouteHandler, RouteParams } from "./types";

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
  readonly requiredPermission?: Permission | undefined;
}

export interface RouteOptions {
  readonly requiredPermission?: Permission | undefined;
}

export interface RouteMatch {
  readonly handler: RouteHandler;
  readonly params: RouteParams;
  readonly requiredPermission?: Permission | undefined;
}

export class Router {
  private readonly routes: Route[] = [];

  add(
    method: string,
    pattern: string,
    handler: RouteHandler,
    options?: RouteOptions,
  ): void {
    const segments = pattern.split("/").filter((s) => s !== "");
    this.routes.push({
      method: method.toUpperCase(),
      segments,
      handler,
      requiredPermission: options?.requiredPermission,
    });
  }

  match(method: string, path: string): RouteMatch | null {
    const pathSegments = path.split("/").filter((s) => s !== "");
    const upper = method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== upper) continue;
      if (route.segments.length !== pathSegments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]!;
        const val = pathSegments[i]!;
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = val;
        } else if (seg !== val) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return {
          handler: route.handler,
          params,
          requiredPermission: route.requiredPermission,
        };
      }
    }

    return null;
  }
}
