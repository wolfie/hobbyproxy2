import express from "express";
import http from "http";
import https from "https";
import env from "../lib/env.ts";
import { randomUUID } from "crypto";
import proxy from "./proxy.ts";
import onlyLanMiddleware from "./onlyLanMiddleware.ts";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import upgradeToHttpsMiddleware from "./upgradeToHttpsMiddleware.ts";
import { z } from "zod/v4";
import mapBodyLegacyToV2 from "./mapBodyLegacyToV2.ts";

export type CertInfo = { key: Buffer; cert: Buffer };
export type CertProvider = { getSslCert: () => Readonly<CertInfo> };

export type ProxyRouteProvider = {
  getRoutes: () => { host: string; target: string; expires: Date }[];
  getRoute: (
    hostname: string
  ) => { hostname: string; port: number } | undefined;
  setRoute: (
    hostname: string,
    targetHostname: string,
    targetPort: number,
    expires: Date
  ) => void;
  removeRoute: (hostname: string) => void;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FAVICON_BUFFER = fs.readFileSync(path.resolve(__dirname, "favicon.png"));

const CHALLENGE_TIMEOUT_MS = 10_000; // 10sec

const PostBodyLegacy = z.object({
  ver: z.undefined().optional(),
  hostname: z.string(),
  target: z.string(),
  staleInDays: z.int().optional(),
});
const PostBodyV2 = z.object({
  version: z.literal(2),
  hostname: z.string(),
  target: z.object({
    hostname: z.string(),
    port: z.int(),
  }),
  expires: z.iso.datetime().transform((datetime) => new Date(datetime)),
});
export type PostBodyLegacy = z.infer<typeof PostBodyLegacy>;
export type PostBodyV2 = z.infer<typeof PostBodyV2>;
const PostBody = z.discriminatedUnion("ver", [PostBodyLegacy, PostBodyV2]);

const DeleteBody = z.object({
  hostname: z.string(),
});

const createVerifyChallenge =
  (ignoreFailure: boolean) => async (url: string, challenge: string) => {
    let timeout = false;
    const abortController = new AbortController();
    setTimeout(() => {
      timeout = true;
      abortController.abort();
    }, CHALLENGE_TIMEOUT_MS);

    let errorMessage = "";
    try {
      const result = await fetch(url, { signal: abortController.signal });
      const challengeResult = await result.text();
      if (result.status !== 200 || challenge !== challengeResult) {
        errorMessage = `Failed challenge for ${url}\nHTTP ${result.status}\n\n${challengeResult}`;
      }
    } catch (e) {
      if (timeout) {
        errorMessage = `Challenge for ${url} timed out (${CHALLENGE_TIMEOUT_MS}ms)`;
      } else {
        throw e;
      }
    }

    if (errorMessage) {
      if (ignoreFailure) console.warn(errorMessage);
      else throw new Error(errorMessage);
    }
  };

type Options = { startupChallenge: "error" | "ignore" | "skip" };

const DEFAULT_OPTIONS: Options = {
  startupChallenge: "error",
};

class ApiServer {
  #proxyRouteProvider: ProxyRouteProvider;

  #app: express.Application;
  #httpServer: http.Server;
  #httpsServer: https.Server;

  #challenges: { [path: string]: string | undefined } = {};

  #opts: Options;

  constructor(
    certProvider: CertProvider,
    proxyRouteProvider: ProxyRouteProvider,
    opts?: Partial<Options>
  ) {
    this.#proxyRouteProvider = proxyRouteProvider;
    this.#opts = { ...DEFAULT_OPTIONS, ...opts };

    this.#app = express();
    this.#app.disable("x-powered-by");
    this.#httpServer = http.createServer(this.#app);
    this.#httpsServer = https.createServer(
      { ...certProvider.getSslCert() },
      this.#app
    );

    this.#app.get("/.well-known/hobbyproxy/:challengeId", (req, res, next) => {
      if (Object.keys(this.#challenges).length === 0) return next();

      const challenge = this.#challenges[req.params.challengeId];
      if (!challenge) {
        res.status(404).send("Not Found");
      } else {
        res.send(challenge);
      }
    });

    this.#app.get(
      ["/favicon.ico", "favicon.ico"],
      onlyLanMiddleware,
      (req, res) => {
        res.contentType("image/png").send(FAVICON_BUFFER);
      }
    );

    this.#app.get("/", onlyLanMiddleware, (req, res) => {
      res.send(this.#proxyRouteProvider.getRoutes());
    });

    this.#app.post("/", onlyLanMiddleware, (req, res) => {
      console.log("Got POST request to update proxy route");
      const bodyParseResult = PostBody.safeParse(req.body);
      if (!bodyParseResult.success) {
        res.status(400).send(bodyParseResult.error);
        return;
      }

      let body: PostBodyV2;
      if ("version" in bodyParseResult.data) {
        body = bodyParseResult.data;
      } else {
        // support legacy pinger format
        const bodyMapResult = mapBodyLegacyToV2(bodyParseResult.data, req);
        if (bodyMapResult.success) {
          body = bodyMapResult.data;
        } else {
          res.status(400).send(bodyMapResult.details);
          return;
        }
      }

      const { hostname, target, expires } = body;
      this.#proxyRouteProvider.setRoute(
        hostname,
        target.hostname,
        target.port,
        expires
      );
    });

    this.#app.delete("/", onlyLanMiddleware, (req, res) => {
      console.log("Got DELETE request to delete proxy route");
    });

    this.#app.use(upgradeToHttpsMiddleware, (req, res) => {
      const target = this.#proxyRouteProvider.getRoute(req.hostname);
      if (!target) res.status(404).send();
      else proxy(target.hostname, target.port, req, res);
    });
  }

  async start(): Promise<void> {
    const { promise: httpPromise, resolve: httpResolve } =
      Promise.withResolvers<void>();
    this.#httpServer.listen(env().HTTP_PORT, "0.0.0.0", () => {
      console.log(`HTTP server started on port ${env().HTTP_PORT}`);
      httpResolve();
    });

    const { promise: httpsPromise, resolve: httpsResolve } =
      Promise.withResolvers<void>();
    this.#httpsServer.listen(env().HTTPS_PORT, "0.0.0.0", () => {
      console.log(`HTTPS server started on port ${env().HTTPS_PORT}`);
      httpsResolve();
    });

    await Promise.all([httpPromise, httpsPromise]);
    await this.verifyDnsWorks();
  }

  private async verifyDnsWorks() {
    if (this.#opts.startupChallenge === "skip") {
      console.log("Skipping DNS challenge verification");
      return;
    }

    const rootPath = randomUUID();
    const rootUrl = `${env().DOMAIN_NAME}/.well-known/hobbyproxy/${rootPath}`;
    const rootChallenge = randomUUID();
    console.log(
      `Creating challenge for http(s)://${rootUrl} with the value ${rootChallenge}`
    );
    this.#challenges[rootPath] = rootChallenge;

    const verifyChallenge = createVerifyChallenge(
      this.#opts.startupChallenge === "ignore"
    );

    await verifyChallenge(`http://${rootUrl}`, rootChallenge);
    await verifyChallenge(`https://${rootUrl}`, rootChallenge);

    const wildcardPath = randomUUID();
    const wildcardUrl = `${randomUUID()}.${
      env().DOMAIN_NAME
    }/.well-known/hobbyproxy/${wildcardPath}`;
    const wildcardChallenge = randomUUID();
    console.log(
      `Creating challenge for http(s)://${wildcardUrl} with the value ${wildcardChallenge}`
    );
    this.#challenges[wildcardPath] = wildcardChallenge;
    await verifyChallenge(`http://${wildcardUrl}`, wildcardChallenge);
    await verifyChallenge(`https://${wildcardUrl}`, wildcardChallenge);

    console.log("Challenges done!");
    this.#challenges = {};
  }
}

export default ApiServer;
