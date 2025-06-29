import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";

import getProjectRoot from "../lib/getProjectRoot.ts";
import LogSpan from "../logger/LogSpan.ts";

const RoutesJsonSchema = z.record(
  z.string(),
  z.object({
    targetHostname: z.string(),
    targetPort: z.number(),
    expires: z.iso.datetime().transform((x) => new Date(x)),
  }),
);
type RoutesMap = z.infer<typeof RoutesJsonSchema>;

const ROUTES_JSON_PATH = path.resolve(getProjectRoot(), "routes.db.json");

const readRoutesFromDisk = async (): Promise<RoutesMap> =>
  fs.existsSync(ROUTES_JSON_PATH)
    ? fs.promises
        .readFile(ROUTES_JSON_PATH, "utf-8")
        .then((str) => JSON.parse(str))
        .then(RoutesJsonSchema.parse)
    : {};

const writeRoutesToDisk = async (routesMap: RoutesMap, span: LogSpan) => {
  span.logNoNtfy("PROXY", "Writing routes to disk");
  await fs.promises.writeFile(
    ROUTES_JSON_PATH,
    JSON.stringify(routesMap, null, 2) + "\n",
  );
  span.logNoNtfy("PROXY", "  ...done!");
};

class ProxyManager {
  #proxiesMap: RoutesMap;

  static async create(span: LogSpan) {
    span.log("PROXY", "Loading initial entries from disk");
    let proxiesMap = await readRoutesFromDisk();

    const entries = Object.entries(proxiesMap);
    if (entries.length === 0) {
      span.log("PROXY", "  ...no entries found");
    } else {
      Object.entries(proxiesMap).forEach(([hostname, value]) =>
        span.log(
          "PROXY",
          `  ...loaded entry for ${hostname} -> ${value.targetHostname}:${value.targetPort}`,
        ),
      );
    }

    const manager = new ProxyManager(proxiesMap as RoutesMap);
    await manager.pruneExpiringRoutes(span);
    return manager;
  }

  private constructor(proxiesMap: RoutesMap) {
    this.#proxiesMap = proxiesMap;

    setInterval(
      async () => {
        await using span = new LogSpan("Expiration Batch Job");
        this.pruneExpiringRoutes(span);
      },
      60 * 60 * 1000, // hourly
    );
  }

  private async pruneExpiringRoutes(span: LogSpan) {
    const now = Date.now();
    let somethingWasFiltered = false;
    Object.entries({ ...this.#proxiesMap }).forEach(([site, info]) => {
      if (info.expires.getTime() < now) {
        somethingWasFiltered = true;
        span.log(
          "PROXY",
          `Discarding route for ${site} (${info.targetHostname}:${info.targetPort}), expired at ${info.expires.toISOString()}`,
        );
        delete this.#proxiesMap[site];
      }
    });
    if (somethingWasFiltered) await writeRoutesToDisk(this.#proxiesMap, span);
  }

  getRoute(hostname: string) {
    const route = this.#proxiesMap[hostname];
    return route && { hostname: route.targetHostname, port: route.targetPort };
  }

  async setRoute(
    hostname: string,
    targetHostname: string,
    targetPort: number,
    expires: Date,
    span: LogSpan,
  ) {
    span.log(
      "PROXY",
      `Updating route: ${hostname} -> ${targetHostname}:${targetPort} (valid until ${expires.toISOString()})`,
    );
    this.#proxiesMap[hostname] = { targetHostname, targetPort, expires };
    await fs.promises.writeFile(
      ROUTES_JSON_PATH,
      JSON.stringify(this.#proxiesMap, null, 2),
    );
  }

  getRoutes() {
    return Object.entries(this.#proxiesMap).map(([host, target]) => ({
      host,
      target: `${target.targetHostname}:${target.targetPort}`,
      expires: target.expires,
    }));
  }

  async removeRoute(hostname: string, span: LogSpan) {
    const oldMap = { ...this.#proxiesMap };
    delete this.#proxiesMap[hostname];
    if (Object.keys(oldMap).length > Object.keys(this.#proxiesMap).length) {
      span.log("PROXY", `Deleted route to ${hostname}`);
      await writeRoutesToDisk(this.#proxiesMap, span);
    }
  }
}

export default ProxyManager;
