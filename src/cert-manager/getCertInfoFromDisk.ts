import fs from "node:fs";
import path from "node:path";

import type { CertInfo } from "../api-server/ApiServer.ts";
import env from "../lib/env.ts";

const getCertInfoFromDisk = async (
  certDir: string,
): Promise<CertInfo | undefined> => {
  const keyPath = path.resolve(certDir, env().DOMAIN_NAME + ".key.pem");
  if (!fs.existsSync(keyPath)) {
    console.log(`Key file not found in ${keyPath}`);
    return undefined;
  }

  const certPath = path.resolve(certDir, env().DOMAIN_NAME + ".cert.pem");
  if (!fs.existsSync(certPath)) {
    console.log(`Cert file not found in ${certPath}`);
  }

  console.log("Loading cert info from:");
  console.log(`  - ${keyPath}`);
  console.log(`  - ${certPath}`);
  const [key, cert] = await Promise.all([
    fs.promises.readFile(keyPath),
    fs.promises.readFile(certPath),
  ]);
  console.log("  ...done!");

  return { key, cert };
};

export default getCertInfoFromDisk;
