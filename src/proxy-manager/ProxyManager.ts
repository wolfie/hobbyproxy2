import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";

import { format } from "node:util";
import getProjectRoot from "../lib/getProjectRoot.ts";
import type { ExtractedZip } from "../lib/unzip.ts";
import unzip from "../lib/unzip.ts";
import LogSpan from "../logger/LogSpan.ts";
import { flushAllBuffers } from "../logger/NtfyBuffer.ts";

type HttpJsonType = z.infer<typeof HttpJsonType>;
const HttpJsonType = z.object({
  type: z.literal("http"),
  targetHostname: z.string(),
  targetPort: z.number(),
  expires: z.iso.datetime().transform((x) => new Date(x)),
});

type ZipJsonType = z.infer<typeof ZipJsonType>;
const ZipJsonType = z.object({
  type: z.literal("zip"),
  filename: z.string(),
});

const RoutesJsonSchema = z.record(
  z.string(),
  z.discriminatedUnion("type", [HttpJsonType, ZipJsonType]),
);

type RoutesJson = z.infer<typeof RoutesJsonSchema>;

const ROUTES_JSON_PATH = path.resolve(getProjectRoot(), "routes.db.json");
const ZIP_PATH = path.resolve(getProjectRoot(), "zip");

const readRoutesFromDisk = async (span: LogSpan): Promise<RoutesJson> => {
  if (!fs.existsSync(ROUTES_JSON_PATH)) return {};
  const content = await fs.promises.readFile(ROUTES_JSON_PATH, "utf-8");
  const result = RoutesJsonSchema.safeParse(JSON.parse(content));
  if (!result.success) {
    span.log("PROXY", z.prettifyError(result.error));
    await flushAllBuffers();
    process.exit(1);
  }
  return result.data;
};

const writeRoutesToDisk = async (routesJson: RoutesJson, span: LogSpan) => {
  span.logNoNtfy("PROXY", "Writing routes to disk");
  await fs.promises.writeFile(
    ROUTES_JSON_PATH,
    JSON.stringify(routesJson, null, 2) + "\n",
  );
  span.logNoNtfy("PROXY", "  ...done!");
};

export type SetHttpRouteResult =
  | { success: true }
  | { success: false; reason: "error"; error: any };

export type SetZipRouteResult =
  | { success: true }
  | { success: false; reason: "file-already-exists" }
  | { success: false; reason: "error"; error: any };

class ProxyManager {
  #routesJson: RoutesJson;
  #zipSites: { [hostname: string]: ExtractedZip };

  static async create(span: LogSpan) {
    span.log("PROXY", "Loading initial entries from disk");
    const proxiesMap = await readRoutesFromDisk(span);
    const zipSites: { [hostname: string]: ExtractedZip } = {};

    const entries = Object.entries(proxiesMap);
    if (entries.length === 0) {
      span.log("PROXY", "  ...no entries found");
    } else {
      for (const [hostname, value] of Object.entries(proxiesMap)) {
        if (value.type === "http") {
          span.log(
            "PROXY",
            `  ...loaded entry for ${hostname} -> http://${value.targetHostname}:${value.targetPort}`,
          );
        } else if (value.type === "zip") {
          const buffer = await fs.promises.readFile(
            path.join(ZIP_PATH, value.filename),
          );
          zipSites[hostname] = await unzip(buffer);
          span.log(
            "PROXY",
            `  ...loaded entry for ${hostname} -> zip://${value.filename} with ${Object.keys(zipSites[hostname]).length} file(s)`,
          );
        } else {
          span.log(
            "PROXY",
            `Unhandled proxy type "${(value as any).type}" for ${hostname}`,
          );
          await flushAllBuffers();
          process.exit(1);
        }
      }
    }

    const manager = new ProxyManager(proxiesMap, zipSites);
    await manager.pruneExpiringRoutes(span);
    await manager.cleanupOrphanZipFiles(span);
    return manager;
  }

  private constructor(
    routesJson: RoutesJson,
    zipSites: { [hostname: string]: ExtractedZip },
  ) {
    this.#routesJson = routesJson;
    this.#zipSites = zipSites;

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
    Object.entries({ ...this.#routesJson }).forEach(([site, info]) => {
      if ("expires" in info && info.expires.getTime() < now) {
        somethingWasFiltered = true;
        span.log(
          "PROXY",
          `Discarding route for ${site} (${info.targetHostname}:${info.targetPort}), expired at ${info.expires.toISOString()}`,
        );
        delete this.#routesJson[site];
      }
    });
    if (somethingWasFiltered) {
      await writeRoutesToDisk(this.#routesJson, span);
    }
  }

  getRoute(hostname: string, span: LogSpan) {
    const route = this.#routesJson[hostname];
    if (!route) return undefined;
    else if (route.type === "http") {
      return route;
    } else if (route.type === "zip") {
      return {
        ...route,
        contents: this.#zipSites[hostname] ?? {},
      };
    } else {
      span.log(
        "PROXY",
        `Unhandled proxy type "${(route as any).type}" for ${hostname}`,
      );
      flushAllBuffers().then(() => process.exit(1));
    }
  }

  async setHttpRoute(
    hostname: string,
    targetHostname: string,
    targetPort: number,
    expires: Date,
    span: LogSpan,
  ): Promise<SetHttpRouteResult> {
    try {
      span.log(
        "PROXY",
        `Updating route: ${hostname} -> ${targetHostname}:${targetPort} (valid until ${expires.toISOString()})`,
      );
      this.#routesJson[hostname] = {
        type: "http",
        targetHostname,
        targetPort,
        expires,
      };
      await writeRoutesToDisk(this.#routesJson, span);
      return { success: true };
    } catch (e) {
      return { success: false, reason: "error", error: e };
    }
  }

  async setZipRoute(
    hostname: string,
    filename: string,
    buffer: Buffer,
    span: LogSpan,
  ): Promise<SetZipRouteResult> {
    try {
      await fs.promises.mkdir(ZIP_PATH, { recursive: true });
    } catch (e) {
      span.logNoNtfy("PROXY", "Tried to create ZIP path " + ZIP_PATH);
      span.logNoNtfy("PROXY", format(e));
      return { success: false, reason: "error", error: e };
    }

    if (fs.existsSync(path.join(ZIP_PATH, filename))) {
      return { success: false, reason: "file-already-exists" };
    }

    span.log("PROXY", `Updating route: ${hostname} -> ${filename}`);

    // no need to slow down and `await` this
    unzip(buffer).then((contents) => {
      this.#zipSites[hostname] = contents;
    });

    const zipFilePath = path.join(ZIP_PATH, filename);
    span.log("PROXY", `Writing ${zipFilePath}`);
    try {
      this.#routesJson[hostname] = { type: "zip", filename };
      await fs.promises.writeFile(zipFilePath, buffer);
      await writeRoutesToDisk(this.#routesJson, span).catch(async (e) => {
        span.log("PROXY", `Reverting: deleting ${zipFilePath}`);
        await fs.promises.rm(zipFilePath);
        throw e;
      });
    } catch (e) {
      return { success: false, reason: "error", error: e };
    }
    return { success: true };
  }

  getRoutes() {
    return Object.entries(this.#routesJson).map(([host, route]) => {
      switch (route.type) {
        case "http":
          return {
            host,
            ...route,
          };
        case "zip":
          return {
            host,
            ...route,
            zipContents: Object.keys(this.#zipSites[host] ?? {}),
          };
      }
    });
  }

  async removeRoute(
    hostname: string,
    span: LogSpan,
  ): Promise<
    | { success: true }
    | { success: false; reason: "hostname-not-found" }
    | { success: false; reason: "error"; error: any }
  > {
    const site = this.#routesJson[hostname];
    if (!site) return { success: false, reason: "hostname-not-found" };

    if (site.type === "zip") {
      try {
        await fs.promises.rm(path.join(ZIP_PATH, site.filename));
      } catch (e) {
        return { success: false, reason: "error", error: e };
      }
    }

    const oldMap = { ...this.#routesJson };

    delete this.#routesJson[hostname];
    delete this.#zipSites[hostname];
    if (Object.keys(oldMap).length > Object.keys(this.#routesJson).length) {
      span.log("PROXY", `Deleted route to ${hostname}`);
      try {
        await writeRoutesToDisk(this.#routesJson, span);
      } catch (e) {
        span.log("PROXY", `error: ${format(e)}`);
        return { success: false, reason: "error", error: e };
      }
    }

    return { success: true };
  }

  private async cleanupOrphanZipFiles(span: LogSpan) {
    const filesToDelete = new Set(await fs.promises.readdir(ZIP_PATH));
    this.getRoutes()
      .filter((route) => route.type === "zip")
      .forEach((route) => filesToDelete.delete(route.filename));

    const results = await Promise.allSettled(
      [...filesToDelete].map((file) => {
        const orphanFilePath = path.join(ZIP_PATH, file);
        span.log("PROXY", `Deleting orphan file ${orphanFilePath}`);
        return fs.promises.rm(orphanFilePath);
      }),
    );

    results
      .filter((r) => r.status === "rejected")
      .forEach((e) => span.log("PROXY", `error: ${format(e)}`));
  }
}

export default ProxyManager;
