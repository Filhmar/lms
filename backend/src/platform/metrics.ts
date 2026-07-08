import { createServer, type Server } from "node:http";
import { Logger } from "@nestjs/common";
import { collectDefaultMetrics, Registry } from "prom-client";

/**
 * Standalone prom-client /metrics server (blueprint pattern): deliberately
 * NOT a Nest route so scraping never interacts with API middleware, and the
 * port stays internal to the container network (never published to a host).
 */
export function startMetricsServer(port: number): Server {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const server = createServer((req, res) => {
    if (req.url === "/metrics") {
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { "Content-Type": registry.contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    new Logger("Metrics").log(`prom-client metrics on :${port}/metrics`);
  });
  return server;
}
