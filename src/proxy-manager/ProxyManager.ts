import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";

import filterValues from "../lib/filterValues.ts";
import getProjectRoot from "../lib/getProjectRoot.ts";
import type LogSpan from "../logger/LogSpan.ts";

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
    JSON.stringify(routesMap, null, 2),
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
      let somethingWasFiltered = false;
      const now = Date.now();
      proxiesMap = filterValues(proxiesMap, (value, hostname) => {
        const keep = now < new Date(value.expires).getTime();
        if (!keep) {
          span.log("PROXY", `  ...discarding expired entry for ${hostname}`);
          somethingWasFiltered = true;
        }
        return keep;
      }) as RoutesMap;

      if (somethingWasFiltered) await writeRoutesToDisk(proxiesMap, span);
    }

    return new ProxyManager(proxiesMap as RoutesMap);
  }

  private constructor(proxiesMap: RoutesMap) {
    this.#proxiesMap = proxiesMap;
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
