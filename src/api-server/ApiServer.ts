import express from "express";
import http from "http";
import https from "https";
import env from "../lib/env.ts";
import { randomUUID } from "crypto";
import proxy from "./proxy.ts";

export type CertInfo = { key: Buffer; cert: Buffer };
export type CertProvider = { getSslCert: () => Readonly<CertInfo> };

export type ProxyRouteProvider = {
  getRoute: (
    hostname: string
  ) => { hostname: string; port: number } | undefined;
  setRoute: (
    hostname: string,
    targetHostname: string,
    targetPort: number,
    expires: Date
  ) => void;
};

const CHALLENGE_TIMEOUT_MS = 10_000; // 10sec

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

type Options = Partial<{ startupChallenge?: "error" | "ignore" | "skip" }>;

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
    opts: Options
  ) {
    this.#proxyRouteProvider = proxyRouteProvider;
    this.#opts = opts;

    this.#app = express();
    this.#httpServer = http.createServer(this.#app);
    this.#httpsServer = https.createServer(
      { ...certProvider.getSslCert() },
      this.#app
    );

    this.#app
      .route("/.well-known/hobbyproxy/:challengeId")
      .get((req, res, next) => {
        if (Object.keys(this.#challenges).length === 0) return next();

        const challenge = this.#challenges[req.params.challengeId];
        if (!challenge) {
          res.status(404).send("Not Found");
        } else {
          res.send(challenge);
        }
      });

    this.#app.use((req, res) => {
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
