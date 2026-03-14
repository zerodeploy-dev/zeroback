import type { ActionCtx } from "./types.js";

export type HttpActionHandler = (ctx: ActionCtx<any>, request: Request) => Promise<Response>;

export interface HttpAction {
  _type: "httpAction";
  handler: HttpActionHandler;
}

export interface HttpRoute {
  method: string;
  path?: string;
  pathPrefix?: string;
  handler: HttpActionHandler;
}

export class HttpRouter {
  readonly routes: HttpRoute[] = [];

  route(config: { path: string; method: string; handler: HttpAction }): void {
    this.routes.push({
      method: config.method.toUpperCase(),
      path: config.path,
      handler: config.handler.handler,
    });
  }

  routeWithPrefix(config: { pathPrefix: string; method: string; handler: HttpAction }): void {
    this.routes.push({
      method: config.method.toUpperCase(),
      pathPrefix: config.pathPrefix,
      handler: config.handler.handler,
    });
  }

  /** Find the handler for a given method + path. */
  lookup(method: string, path: string): HttpActionHandler | null {
    const upperMethod = method.toUpperCase();

    // Exact match first
    for (const route of this.routes) {
      if (route.method === upperMethod && route.path === path) {
        return route.handler;
      }
    }

    // Prefix match
    for (const route of this.routes) {
      if (route.method === upperMethod && route.pathPrefix && path.startsWith(route.pathPrefix)) {
        return route.handler;
      }
    }

    return null;
  }
}

export function httpRouter(): HttpRouter {
  return new HttpRouter();
}

export function httpAction(handler: HttpActionHandler): HttpAction {
  return { _type: "httpAction", handler };
}
