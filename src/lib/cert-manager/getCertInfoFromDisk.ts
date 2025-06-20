import path from "node:path";
import type { CertInfo } from "../ApiServer.ts";
import fs from "node:fs";

const getCertInfoFromDisk = async (
  certDir: string
): Promise<CertInfo | undefined> => {
  const keyPath = path.resolve(certDir, "sommarbacka.com.key.pem");
  if (!fs.existsSync(keyPath)) {
    console.log(`Key file not found in ${keyPath}`);
    return undefined;
  }

  const certPath = path.resolve(certDir, "sommarbacka.com.cert.pem");
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
