import type { RequestHandler } from "express";
import unzip, { type ExtractedZip } from "../lib/unzip.ts";

const getSuffixOf = (path: string) => path.split(".").at(-1);

const isBuffer = (x: unknown): x is Buffer => x instanceof Buffer;

function staticZipRoute(extractedZip: ExtractedZip): RequestHandler;
function staticZipRoute(zipFileBuffer: Buffer): RequestHandler;
function staticZipRoute(arg: Buffer | ExtractedZip): RequestHandler {
  const zipContentsPromise = isBuffer(arg) ? unzip(arg) : arg;

  return async (req, res) => {
    const zipContents = await zipContentsPromise;
    let path = req.path.substring(1); // strip initial '/'
    if (!path) path = "index.html";
    let buffer = zipContents[path];
    if (!buffer) {
      if (!path.endsWith("/")) path += "/";
      path += "index.html";
      buffer = zipContents[path];
    }

    if (!buffer) {
      res.status(404).send();
    } else {
      res
        .contentType(getSuffixOf(path) ?? "application/octet-stream")
        .send(buffer);
    }
  };
}
export default staticZipRoute;
