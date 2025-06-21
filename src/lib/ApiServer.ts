import express from "express";
import http from "http";
import https from "https";
import env from "./env.ts";

export type CertInfo = { key: Buffer; cert: Buffer };
export type CertProvider = { getSslCert: () => Readonly<CertInfo> };

class ApiServer {
  #app: express.Application;
  #httpServer: http.Server;
  #httpsServer: https.Server;

  constructor(certProvider: CertProvider) {
    this.#app = express();
    this.#httpServer = http.createServer(this.#app);
    this.#httpsServer = https.createServer(
      { ...certProvider.getSslCert() },
      this.#app
    );

    this.#httpsServer.on("error", (...args) => console.error("!!!", ...args));
    this.#app.on("error", (app) => console.error("!!!!", app));
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
  }
}

export default ApiServer;
