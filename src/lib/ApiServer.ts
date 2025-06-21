import express from "express";
import http from "http";
import https from "https";
import env from "./env.ts";
import { randomUUID } from "crypto";

export type CertInfo = { key: Buffer; cert: Buffer };
export type CertProvider = { getSslCert: () => Readonly<CertInfo> };

const CHALLENGE_TIMEOUT_MS = 10_000; // 10sec

const verifyChallenge = async (url: string, challenge: string) => {
  let timeout = false;
  const abortController = new AbortController();
  setTimeout(() => {
    timeout = true;
    abortController.abort();
  }, CHALLENGE_TIMEOUT_MS);

  try {
    const result = await fetch(url, { signal: abortController.signal });
    const challengeResult = await result.text();
    if (result.status !== 200 || challenge !== challengeResult) {
      throw new Error(
        `Failed challenge for ${url}\nHTTP ${result.status}\n\n${challengeResult}`
      );
    }
  } catch (e) {
    if (timeout) {
      throw new Error(
        `Challenge for ${url} timed out (${CHALLENGE_TIMEOUT_MS}ms)`
      );
    } else {
      throw e;
    }
  }
};

class ApiServer {
  #app: express.Application;
  #httpServer: http.Server;
  #httpsServer: https.Server;

  #challenges: { [path: string]: string | undefined } = {};

  constructor(certProvider: CertProvider) {
    this.#app = express();
    this.#httpServer = http.createServer(this.#app);
    this.#httpsServer = https.createServer(
      { ...certProvider.getSslCert() },
      this.#app
    );

    this.#app.route("/.well-known/hobbyproxy/:challengeId").get((req, res) => {
      const challenge = this.#challenges[req.params.challengeId];
      if (!challenge) {
        res.status(404).send("Not Found");
      } else {
        res.send(challenge);
      }
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
    const rootPath = randomUUID();
    const rootUrl = `${env().DOMAIN_NAME}/.well-known/hobbyproxy/${rootPath}`;
    const rootChallenge = randomUUID();
    console.log(
      `Creating challenge for http(s)://${rootUrl} with the value ${rootChallenge}`
    );
    this.#challenges[rootPath] = rootChallenge;
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

    console.log("Challenges ok!");
    this.#challenges = {};
  }
}

export default ApiServer;
