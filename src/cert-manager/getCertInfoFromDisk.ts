import fs from "node:fs";
import path from "node:path";

import env from "../env.ts";
import type LogSpan from "../logger/LogSpan.ts";
import type { CertInfo } from "./CertManager.ts";

const getCertInfoFromDisk = async (
  certDir: string,
  span: LogSpan,
): Promise<CertInfo | undefined> => {
  const keyPath = path.resolve(certDir, env().DOMAIN_NAME + ".key.pem");
  if (!fs.existsSync(keyPath)) {
    span.log("CERT", `Key file not found in ${keyPath}`);
    return undefined;
  }

  const certPath = path.resolve(certDir, env().DOMAIN_NAME + ".cert.pem");
  if (!fs.existsSync(certPath)) {
    span.log("CERT", `Cert file not found in ${certPath}`);
    return undefined;
  }

  span.log("CERT", "Loading cert info from:");
  span.log("CERT", `  - ${keyPath}`);
  span.log("CERT", `  - ${certPath}`);
  const [key, cert] = await Promise.all([
    fs.promises.readFile(keyPath),
    fs.promises.readFile(certPath),
  ]);
  span.log("CERT", "  ...done!");

  return { key, cert };
};

export default getCertInfoFromDisk;
