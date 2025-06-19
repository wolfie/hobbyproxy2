import express from "express";
import http from "http";
import http2 from "http2";
import http2ExpressBridge from "http2-express-bridge";
import env from "./env.ts";

export type CertInfo = { key: Buffer; cert: Buffer };
export type CertProvider = { getSslCert: () => Readonly<CertInfo> };

class ApiServer {
  #app: express.Application;
  #httpServer: http.Server;
  #httpsServer: http2.Http2SecureServer;

  constructor(certProvider: CertProvider) {
    this.#app = http2ExpressBridge(express);

    this.#httpServer = http.createServer(this.#app);
    this.#httpsServer = http2.createSecureServer(
      { ...certProvider.getSslCert(), allowHTTP1: true },
      this.#app
    );
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

    return Promise.all([httpPromise, httpsPromise]).then();
  }
}

export default ApiServer;
