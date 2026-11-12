import { afterEach } from "vitest";

/** What the fake web server saw of one request. */
export interface FakeWebRequest {
  /** Path and query. */
  path: string;
  headers: Headers;
}

export interface FakeWeb {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly port: number;
  readonly requests: FakeWebRequest[];
}

/**
 * A small web server on 127.0.0.1 (random port) for tests that fetch an address: `serve(handler)` starts it, every server
 * a test started is stopped afterwards. The tests run with the lenient host policy, which lets loopback and any port through.
 */
export function useFakeWeb() {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));
  });
  return {
    serve(
      handler: (request: Request) => Response | Promise<Response>,
    ): FakeWeb {
      const requests: FakeWebRequest[] = [];
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
          const url = new URL(request.url);
          requests.push({
            path: `${url.pathname}${url.search}`,
            headers: request.headers,
          });
          return handler(request);
        },
      });
      servers.push(server);
      return {
        origin: `http://127.0.0.1:${server.port}`,
        port: server.port as number,
        requests,
      };
    },
    /** A port nothing listens on any more. */
    async closedPort(): Promise<number> {
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response("x"),
      });
      const port = server.port as number;
      await server.stop(true);
      return port;
    },
  };
}
