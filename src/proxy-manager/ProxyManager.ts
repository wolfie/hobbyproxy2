import path from "node:path";
import getProjectRoot from "../lib/getProjectRoot.ts";
import { z } from "zod/v4";
import fs from "node:fs";
import filterValues from "../lib/filterValues.ts";
import type { ProxyRouteProvider } from "../api-server/ApiServer.ts";

const RoutesJsonSchema = z.record(
  z.string(),
  z.object({
    target: z.string(),
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
    let proxiesMap = await readRoutesFromDisk();

    const entries = Object.entries(proxiesMap);
    if (entries.length === 0) {
      console.log("No entries found on disk");
    } else {
      Object.entries(proxiesMap).forEach(([hostname, value]) =>
        console.log(`Loaded entry for ${hostname} -> ${value.target}`)
      );
      let somethingWasFiltered = false;
      const now = Date.now();
      proxiesMap = filterValues(proxiesMap, (value, hostname) => {
        const keep = now < new Date(value.expires).getTime();
        if (!keep) {
          console.log(`Discarding expired entry for ${hostname}`);
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
    process.exit(0);
  }

  getRoute: (hostname: string) => string;
  setRoute: (hostname: string, expires: Date) => void;
}

export default ProxyManager;
