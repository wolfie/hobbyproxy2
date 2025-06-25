import { X509Certificate } from "node:crypto";
import path from "node:path";

import type DnsManager from "../dns-manager/DnsManager.ts";
import getProjectRoot from "../lib/getProjectRoot.ts";
import LogSpan from "../logger/LogSpan.ts";
import getCertFromLetsencrypt from "./getCertFromLetsencrypt.ts";
import getCertInfoFromDisk from "./getCertInfoFromDisk.ts";

const CERT_DIR = path.resolve(getProjectRoot(), "cert");

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type CertInfo = { key: Buffer; cert: Buffer };

class CertManager {
  #certInfo: Readonly<CertInfo>;
  #dnsManager: DnsManager;

  static async create(dnsManager: DnsManager, span: LogSpan) {
    let certInfo = await getCertInfoFromDisk(CERT_DIR, span);
    if (!certInfo) {
      span.log(
        "CERT",
        "Cert info not found on disk, acquiring new from Let's Encrypt",
      );
      certInfo = await getCertFromLetsencrypt(CERT_DIR, dnsManager, span);
    }

    span.log(
      "CERT",
      `Certificate is valid until ${new Date(new X509Certificate(certInfo.cert).validTo).toISOString()}`,
    );

    const certManager = new CertManager(certInfo, dnsManager);
    await certManager.renewCertIfNeeded(span);
    return certManager;
  }

  private constructor(certInfo: CertInfo, dnsManager: DnsManager) {
    this.#certInfo = Object.freeze(certInfo);
    this.#dnsManager = dnsManager;
    setInterval(async () => {
      await using span = new LogSpan("Renew expiring certificate");
      await this.renewCertIfNeeded.bind(this)(span);
    }, DAY_IN_MS);
  }

  getSslCert() {
    return this.#certInfo;
  }

  private async renewCertIfNeeded(span: LogSpan): Promise<void> {
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
      span.log("CERT", "Renewing expiring certificate");
      this.#certInfo = await getCertFromLetsencrypt(
        CERT_DIR,
        this.#dnsManager,
        span,
      );
      span.log("CERT", "  ...done!");
    }
  }
}

export default CertManager;
