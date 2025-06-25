import type express from "express";
import type { IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";

import pipe from "../lib/pipe.ts";
import LogSpan from "../logger/LogSpan.ts";

const applyForwardedHeader =
  (req: express.Request) => (headers: [string, string][]) => {
    // TODO append to existing headers instead of clearing old ones.
    headers = headers.filter(
      ([key]) => !key.startsWith("x-forwarded-") && key !== "forwarded",
    );
    headers.push([
      "forwarded",
      [
        typeof req.socket.remoteAddress !== "undefined" &&
          `for=${req.socket.remoteAddress}`,
        `host=${req.host}`,
        `proto=${req.protocol}`,
      ]
        .filter((x) => !!x)
        .join(";"),
    ]);
    return headers;
  };

const spreadHeaders = (headers: IncomingHttpHeaders): [string, string][] =>
  Object.entries(headers).flatMap(([name, value]) =>
    typeof value !== "undefined"
      ? Array.isArray(value)
        ? value.map((v) => [name, v] as [string, string])
        : ([[name, value]] as [string, string][])
      : [],
  );

const proxy = async (
  hostname: string,
  port: number,
  req: express.Request,
  res: express.Response,
) => {
  const url = `http://${hostname}:${port}${req.originalUrl}`;

  const processHeaders = pipe(spreadHeaders, applyForwardedHeader(req));
  const response = await fetch(url, { headers: processHeaders(req.headers) });
  if (response.body === null) {
    await using span = new LogSpan("Proxy query");
    span.log("PROXY", "Got a null body from " + url);
    res.status(502).send();
    return;
  }

  res.status(response.status);
  res.setHeaders(response.headers);
  Readable.fromWeb(response.body).pipe(res);
};

export default proxy;
