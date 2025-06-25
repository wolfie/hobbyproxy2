import acme, { Client as AcmeClient } from "acme-client";
import fs from "node:fs";
import path from "node:path";

import type DnsManager from "../dns-manager/DnsManager.ts";
import env from "../env.ts";
import LogSpan from "../logger/LogSpan.ts";
import { flushAllBuffers } from "../logger/NtfyBuffer.ts";
import type { CertInfo } from "./CertManager.ts";

const getAcmeAccountKey = async (
  certDir: string,
  span: LogSpan,
): Promise<{ newKeyWasCreated: boolean; buffer: Buffer }> => {
  const keyPath = path.resolve(certDir, "acmeAccount.key.pem");
  if (fs.existsSync(keyPath)) {
    return {
      newKeyWasCreated: false,
      buffer: await fs.promises.readFile(keyPath),
    };
  }

  span.log(
    "CERT",
    `Acme account private key not found in ${keyPath}, creating new one`,
  );
  const keyBuffer = await acme.crypto.createPrivateKey();
  await fs.promises.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.promises.writeFile(keyPath, keyBuffer);
  return {
    newKeyWasCreated: true,
    buffer: keyBuffer,
  };
};

const getAcmeClient = async (
  certDir: string,
  span: LogSpan,
): Promise<AcmeClient> => {
  const accountKeyInfo = await getAcmeAccountKey(certDir, span);
  const acmeClient = new AcmeClient({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: accountKeyInfo.buffer,
  });

  if (accountKeyInfo.newKeyWasCreated) {
    const tosAgreed = env().LETSENCRYPT_TOS_AGREED;
    if (!tosAgreed) {
      const tosUrl = await acmeClient.getTermsOfServiceUrl();
      span.log(
        "CERT",
        `Set LETSENCRYPT_TOS_AGREED=true once you've read ${tosUrl}`,
      );
      await flushAllBuffers();
      process.exit(1);
    }
    acmeClient.createAccount({
      contact: [`mailto:${env().EMAIL}`],
      termsOfServiceAgreed: true,
    });
    // TODO: do we need to sleep here for a while?
  } else {
    acmeClient.updateAccount({ contact: [`mailto:${env().EMAIL}`] });
  }

  return acmeClient;
};

const getCertFromLetsencrypt = async (
  certDir: string,
  dnsManager: DnsManager,
  span: LogSpan,
): Promise<CertInfo> => {
  const acmeClient = await getAcmeClient(certDir, span);

  const [key, csr] = await acme.crypto.createCsr({
    altNames: [env().DOMAIN_NAME, `*.${env().DOMAIN_NAME}`],
  });

  span.logNoNtfy("CERT", "Requesting DNS-01 challenge");
  const certString = await acmeClient.auto({
    csr,
    challengePriority: ["dns-01"],
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      if (challenge.type === "http-01") return;

      span.logNoNtfy(
        "CERT",
        `Setting up DNS-01 challenge answer for ${authz.identifier.value}...`,
      );
      await dnsManager.setTxtRecord(
        `_acme-challenge.${authz.identifier.value}`,
        keyAuthorization,
        span,
      );
      span.logNoNtfy("CERT", "  ...done!");
    },
    challengeRemoveFn: async (authz, challenge, _keyAuthorization) => {
      if (challenge.type === "http-01") return;
      span.logNoNtfy(
        "CERT",
        `Cleaning up DNS-01 challenge for ${authz.identifier.value}...`,
      );
      await dnsManager.removeAllTxtRecords(
        `_acme-challenge.${authz.identifier.value}`,
        span,
      );
      span.logNoNtfy("CERT", "  ...done");
    },
  });

  const cert = Buffer.from(certString);

  const keyPath = path.resolve(certDir, env().DOMAIN_NAME + ".key.pem");
  const certPath = path.resolve(certDir, env().DOMAIN_NAME + ".cert.pem");
  span.log("CERT", `Saving:`);
  span.log("CERT", `  - key to ${keyPath}`);
  span.log("CERT", `  - cert to ${certPath}`);
  await fs.promises.mkdir(certDir, { recursive: true });
  await Promise.all([
    fs.promises.writeFile(keyPath, key),
    fs.promises.writeFile(certPath, cert),
  ]);
  span.log("CERT", "  ...done!");

  return {
    key,
    cert,
  };
};

export default getCertFromLetsencrypt;
