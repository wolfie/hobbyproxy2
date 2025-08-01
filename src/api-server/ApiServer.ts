import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

import type CertManager from "../cert-manager/CertManager.ts";
import env from "../env.ts";
import LogSpan from "../logger/LogSpan.ts";
import { flushAllBuffers } from "../logger/NtfyBuffer.ts";
import type ProxyManager from "../proxy-manager/ProxyManager.ts";
import type {
  SetHttpRouteResult,
  SetZipRouteResult,
} from "../proxy-manager/ProxyManager.ts";
import mapPostBodyToLatest from "./mapPostBodyToLatest.ts";
import onlyLanMiddleware from "./onlyLanMiddleware.ts";
import staticZipRoute from "./staticZipRoute.ts";
import upgradeToHttpsMiddleware from "./upgradeToHttpsMiddleware.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const [FAVICON_BUFFER, UI_BUFFER] = await Promise.all([
  fs.promises.readFile(path.join(__dirname, "favicon.png")),
  fs.promises.readFile(path.join(__dirname, "ui.zip")),
]);

const CHALLENGE_TIMEOUT_MS = 10_000; // 10sec

const PostBodyLegacy = z.object({
  version: z.undefined().optional(),
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

const PostBodyV3Http = z.object({
  version: z.literal(3),
  hostname: z.string(),
  type: z.literal("http"),
  target: z.object({
    hostname: z.string(),
    port: z.int(),
  }),
  expires: z.iso.datetime().transform((datetime) => new Date(datetime)),
});

const PostBodyV3Zip = z.object({
  version: z.literal(3),
  hostname: z.string(),
  type: z.literal("zip"),
  filename: z.string().endsWith(".zip"),
  contents: z.base64({}),
});
const PostBodyV3 = z.discriminatedUnion("type", [
  PostBodyV3Http,
  PostBodyV3Zip,
]);

export type PostBodyLegacy = z.infer<typeof PostBodyLegacy>;
export type PostBodyV2 = z.infer<typeof PostBodyV2>;
export type PostBodyV3 = z.infer<typeof PostBodyV3>;
export type PostBodyLatest = PostBodyV3;

export type PostBody = z.infer<typeof PostBody>;
export const PostBody = z.discriminatedUnion("version", [
  PostBodyLegacy,
  PostBodyV2,
  PostBodyV3,
]);

export type DeleteBody = z.infer<typeof DeleteBody>;
const DeleteBody = z.object({
  hostname: z.string(),
});

const createVerifyChallenge =
  (ignoreFailure: boolean, span: LogSpan) =>
  async (url: string, challenge: string) => {
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
      span.log("API", "‼️ " + errorMessage);
      if (!ignoreFailure) {
        await flushAllBuffers();
        process.exit(1);
      }
    }
  };

type Options = { startupChallenge: "error" | "ignore" | "skip" };

const DEFAULT_OPTIONS: Options = {
  startupChallenge: "error",
};

class ApiServer {
  #proxyManager: ProxyManager;
  #zipRequestHandlers: { [hostname: string]: express.RequestHandler } = {};

  #app: express.Application;
  #httpServer: http.Server;
  #httpsServer: https.Server;

  #challenges: { [path: string]: string | undefined } = {};

  #opts: Options;

  constructor(
    certManager: CertManager,
    proxyManager: ProxyManager,
    opts?: Partial<Options>,
  ) {
    this.#proxyManager = proxyManager;
    this.#opts = { ...DEFAULT_OPTIONS, ...opts };

    this.#app = express();
    this.#app.disable("x-powered-by");
    this.#app.use(express.json());
    this.#httpServer = http.createServer(this.#app);
    this.#httpsServer = https.createServer(
      { ...certManager.getSslCert() },
      this.#app,
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
      },
    );

    this.#app.use("/ui", onlyLanMiddleware, staticZipRoute(UI_BUFFER));

    this.#app.get("/", onlyLanMiddleware, (req, res) => {
      res.send(this.#proxyManager.getRoutes());
    });

    this.#app.post("/", onlyLanMiddleware, async (req, res) => {
      await using span = new LogSpan("POST /");
      span.logNoNtfy("API", "Got POST request to update proxy route");
      const bodyParseResult = PostBody.safeParse(req.body);
      if (!bodyParseResult.success) {
        res.status(400).send(bodyParseResult.error);
        return;
      }

      const bodyMapResult = mapPostBodyToLatest(bodyParseResult.data, req);
      if (!bodyMapResult.success) {
        res.status(400).send(bodyMapResult.details);
        return;
      }

      let result: SetHttpRouteResult | SetZipRouteResult;
      switch (bodyMapResult.data.type) {
        case "http": {
          const { hostname, target, expires } = bodyMapResult.data;
          result = await this.#proxyManager.setHttpRoute(
            hostname,
            target.hostname,
            target.port,
            expires,
            span,
          );
          break;
        }
        case "zip":
          const body = bodyMapResult.data;
          result = await this.#proxyManager.setZipRoute(
            body.hostname,
            body.filename,
            Buffer.from(body.contents, "base64"),
            span,
          );
          break;
        default:
          res.status(500).send({
            success: false,
            error:
              "Internal error: unexpected type " +
              (bodyMapResult.data as any).type,
          });
          return;
      }

      if (result.success) {
        res.send(result);
      } else if (result.reason === "file-already-exists") {
        res.status(400).send(result);
      } else {
        res.status(500).send(result);
      }
    });

    this.#app.delete("/", onlyLanMiddleware, async (req, res) => {
      await using span = new LogSpan("POST /");
      span.logNoNtfy("API", "Got DELETE request to delete proxy route");
      const body = DeleteBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).send(body.error);
        return;
      }

      const hostname = body.data.hostname;
      const result = await this.#proxyManager.removeRoute(hostname, span);
      if (result.success) {
        delete this.#zipRequestHandlers[hostname];
        res.send(result);
      } else if (result.reason === "hostname-not-found") {
        res.status(404).send(result);
      } else {
        res.status(500).send(result);
      }
    });

    this.#app.use(upgradeToHttpsMiddleware, async (req, res, next) => {
      await using span = new LogSpan("Retrieving proxy info");
      const hostname = req.hostname;
      const target = this.#proxyManager.getRoute(hostname, span);
      if (!target) {
        res.status(404).send();
      } else if (target.type === "zip") {
        let zipRequestHandler = this.#zipRequestHandlers[hostname];
        if (!zipRequestHandler) {
          zipRequestHandler = staticZipRoute(target.contents);
          this.#zipRequestHandlers[hostname] = zipRequestHandler;
        }
        zipRequestHandler(req, res, next);
      } else if (target.type === "http") {
        target.httpProxyServer.web(req, res);
      } else {
        span.log(
          "API",
          `Unhandled proxy type ${(target as any).type} for ${hostname}`,
        );
        res
          .status(500)
          .send(`Unhandled proxy type ${(target as any).type} for ${hostname}`);
      }
    });
  }

  async start(span: LogSpan): Promise<void> {
    const { promise: httpPromise, resolve: httpResolve } =
      Promise.withResolvers<void>();
    this.#httpServer.listen(env().HTTP_PORT, "0.0.0.0", () => {
      span.log("API", `HTTP server started on port ${env().HTTP_PORT}`);
      httpResolve();
    });

    const { promise: httpsPromise, resolve: httpsResolve } =
      Promise.withResolvers<void>();
    this.#httpsServer.listen(env().HTTPS_PORT, "0.0.0.0", () => {
      span.log("API", `HTTPS server started on port ${env().HTTPS_PORT}`);
      httpsResolve();
    });

    await Promise.all([httpPromise, httpsPromise]);
    await this.verifyDnsWorks(span);
  }

  private async verifyDnsWorks(span: LogSpan) {
    if (this.#opts.startupChallenge === "skip") {
      span.logNoNtfy("API", "Skipping DNS challenge verification");
      return;
    }

    const rootPath = randomUUID();
    const rootUrl = `${env().DOMAIN_NAME}/.well-known/hobbyproxy/${rootPath}`;
    const rootChallenge = randomUUID();
    span.logNoNtfy(
      "API",
      `Creating challenge for http(s)://${rootUrl} with the value ${rootChallenge}`,
    );
    this.#challenges[rootPath] = rootChallenge;

    const verifyChallenge = createVerifyChallenge(
      this.#opts.startupChallenge === "ignore",
      span,
    );

    await verifyChallenge(`http://${rootUrl}`, rootChallenge);
    await verifyChallenge(`https://${rootUrl}`, rootChallenge);

    const wildcardPath = randomUUID();
    const wildcardUrl = `${randomUUID()}.${
      env().DOMAIN_NAME
    }/.well-known/hobbyproxy/${wildcardPath}`;
    const wildcardChallenge = randomUUID();
    span.logNoNtfy(
      "API",
      `Creating challenge for http(s)://${wildcardUrl} with the value ${wildcardChallenge}`,
    );
    this.#challenges[wildcardPath] = wildcardChallenge;
    await verifyChallenge(`http://${wildcardUrl}`, wildcardChallenge);
    await verifyChallenge(`https://${wildcardUrl}`, wildcardChallenge);

    span.logNoNtfy("API", "Challenges done!");
    this.#challenges = {};
  }
}

export default ApiServer;
