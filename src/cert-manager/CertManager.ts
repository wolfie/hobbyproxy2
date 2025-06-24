import { X509Certificate } from "node:crypto";
import path from "node:path";

import type { CertInfo, CertProvider } from "../api-server/ApiServer.ts";
import getProjectRoot from "../lib/getProjectRoot.ts";
import getCertFromLetsencrypt, {
  type DnsTxtRecordModifier,
} from "./getCertFromLetsencrypt.ts";
import getCertInfoFromDisk from "./getCertInfoFromDisk.ts";

const CERT_DIR = path.resolve(getProjectRoot(), "cert");

const DAY_IN_MS = 24 * 60 * 60 * 1000;

class CertManager implements CertProvider {
  #certInfo: Readonly<CertInfo>;
  #dnsTxtRecordModifier: DnsTxtRecordModifier;

  static async create(dnsTxtRecordModifier: DnsTxtRecordModifier) {
    let certInfo = await getCertInfoFromDisk(CERT_DIR);
    if (!certInfo) {
      console.log(
        "Cert info not found on disk, acquiring new from LetsEncrypt",
      );

      certInfo = await getCertFromLetsencrypt(CERT_DIR, dnsTxtRecordModifier);
    }

    console.log(
      `Certificate is valid until ${new Date(new X509Certificate(certInfo.cert).validTo).toISOString()}`,
    );

    const certManager = new CertManager(certInfo, dnsTxtRecordModifier);
    await certManager.renewCertIfNeeded();
    return certManager;
  }

  private constructor(
    certInfo: CertInfo,
    dnsTxtRecordModifier: DnsTxtRecordModifier,
  ) {
    this.#certInfo = Object.freeze(certInfo);
    this.#dnsTxtRecordModifier = dnsTxtRecordModifier;
    setInterval(this.renewCertIfNeeded.bind(this), DAY_IN_MS);
  }

  getSslCert() {
    return this.#certInfo;
  }

  private async renewCertIfNeeded(): Promise<void> {
    const cert = new X509Certificate(this.#certInfo.cert);
    const validTo = new Date(cert.validTo);
    const validFrom = new Date(cert.validFrom);
    const now = new Date();

    const expiresIn30Days = validTo.getTime() - now.getTime() < 30 * DAY_IN_MS;
    const isAlreadyExpired = validTo.getTime() < now.getTime();
    const wasIssuedLessThanAWeekAgo =
      validFrom.getTime() > now.getTime() - 7 * DAY_IN_MS;

    // some sanity checks in case certificate lifetimes are changed to something weird, and not ending up in a renewal loop
    if (isAlreadyExpired || (!wasIssuedLessThanAWeekAgo && expiresIn30Days)) {
      console.log("Renewing expiring certificate");
      this.#certInfo = await getCertFromLetsencrypt(
        CERT_DIR,
        this.#dnsTxtRecordModifier,
      );
    }
  }
}

export default CertManager;
