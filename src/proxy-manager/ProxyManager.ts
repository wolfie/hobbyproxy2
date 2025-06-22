import path from "node:path";
import getProjectRoot from "../lib/getProjectRoot.ts";
import { z } from "zod/v4";
import fs from "node:fs";
import filterValues from "../lib/filterValues.ts";
import type { ProxyRouteProvider } from "../api-server/ApiServer.ts";
import { hostname } from "node:os";

const RoutesJsonSchema = z.record(
  z.string(),
  z.object({
    targetHostname: z.string(),
    targetPort: z.number(),
    expires: z.iso.datetime().transform((x) => new Date(x)),
  })
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

class ProxyManager implements ProxyRouteProvider {
  #proxiesMap: RoutesMap;

  static async create() {
    console.log("Loading initial entries from disk");
    let proxiesMap = await readRoutesFromDisk();

    const entries = Object.entries(proxiesMap);
    if (entries.length === 0) {
      console.log("  ...no entries found");
    } else {
      Object.entries(proxiesMap).forEach(([hostname, value]) =>
        console.log(
          `  ...loaded entry for ${hostname} -> ${value.targetHostname}:${value.targetPort}`
        )
      );
      let somethingWasFiltered = false;
      const now = Date.now();
      proxiesMap = filterValues(proxiesMap, (value, hostname) => {
        const keep = now < new Date(value.expires).getTime();
        if (!keep) {
          console.log(`  ...liscarding expired entry for ${hostname}`);
          somethingWasFiltered = true;
        }
        return keep;
      }) as RoutesMap;

      if (somethingWasFiltered) {
        console.log("Writing changes back to disk");
        await fs.promises.writeFile(
          ROUTES_JSON_PATH,
          JSON.stringify(proxiesMap, null, 2)
        );
        console.log("  ...done!");
      }
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
    expires: Date
  ) {
    console.log(
      `Updating route: ${hostname} -> ${targetHostname}:${targetPort} (valid until ${expires.toISOString()})`
    );
    this.#proxiesMap[hostname] = { targetHostname, targetPort, expires };
    await fs.promises.writeFile(
      ROUTES_JSON_PATH,
      JSON.stringify(this.#proxiesMap, null, 2)
    );
  }

  getRoutes() {
    return Object.entries(this.#proxiesMap).map(([host, target]) => ({
      host,
      target: `${target.targetHostname}:${target.targetPort}`,
      expires: target.expires,
    }));
  }
}

export default ProxyManager;
