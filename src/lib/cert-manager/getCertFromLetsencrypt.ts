import fs from "fs";
import type { CertInfo } from "../ApiServer.ts";
import acme, { Client as AcmeClient } from "acme-client";
import path from "path";
import env from "../env.ts";
import DnsManager from "../DnsManager.ts";

export type DnsTxtRecordModifier = {
  setTxtEntry(name: string, content: string): Promise<void>;
  removeAllTxtEntries(name: string): Promise<void>;
};

const getAcmeAccountKey = async (
  certDir: string
): Promise<{ newKeyWasCreated: boolean; buffer: Buffer }> => {
  const keyPath = path.resolve(certDir, "acmeAccount.key.pem");
  if (fs.existsSync(keyPath)) {
    return {
      newKeyWasCreated: false,
      buffer: await fs.promises.readFile(keyPath),
    };
  }

  console.log(
    `Acme account private key not found in ${keyPath}, creating new one`
  );
  const keyBuffer = await acme.crypto.createPrivateKey();
  await fs.promises.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.promises.writeFile(keyPath, keyBuffer);
  return {
    newKeyWasCreated: true,
    buffer: keyBuffer,
  };
};

const getAcmeClient = async (certDir: string): Promise<AcmeClient> => {
  const accountKeyInfo = await getAcmeAccountKey(certDir);
  const acmeClient = new AcmeClient({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: accountKeyInfo.buffer,
  });

  if (accountKeyInfo.newKeyWasCreated) {
    const tosAgreed = env().LETSENCRYPT_TOS_AGREED;
    if (!tosAgreed) {
      const tosUrl = await acmeClient.getTermsOfServiceUrl();
      throw new Error(
        `Set LETSENCRYPT_TOS_AGREED=true once you've read ${tosUrl}`
      );
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

const getCertFromLetsencrypt = async (certDir: string): Promise<CertInfo> => {
  const [acmeClient, dnsTxtRecordModifier] = await Promise.all([
    getAcmeClient(certDir),
    DnsManager.create(),
  ]);

  const [key, csr] = await acme.crypto.createCsr({
    altNames: [env().DOMAIN_NAME, `*.${env().DOMAIN_NAME}`],
  });

  console.log("Requesting DNS-01 challenge");
  const certString = await acmeClient.auto({
    csr,
    challengePriority: ["dns-01"],
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      if (challenge.type === "http-01") return;

      console.log(
        `Setting up DNS-01 challenge answer for ${authz.identifier.value}...`
      );
      await dnsTxtRecordModifier.setTxtEntry(
        `_acme-challenge.${authz.identifier.value}`,
        keyAuthorization
      );
      console.log("  ...done!");
    },
    challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
      if (challenge.type === "http-01") return;
      console.log(
        `Cleaning up DNS-01 challenge for ${authz.identifier.value}...`
      );
      await dnsTxtRecordModifier.removeAllTxtEntries(
        `_acme-challenge.${authz.identifier.value}`
      );
      console.log("  ...done");
    },
  });

  const cert = Buffer.from(certString);

  const keyPath = path.resolve(certDir, env().DOMAIN_NAME + ".key.pem");
  const certPath = path.resolve(certDir, env().DOMAIN_NAME + ".cert.pem");
  console.log(`Saving:`);
  console.log(`  - key to ${keyPath}`);
  console.log(`  - cert to ${certPath}`);
  await fs.promises.mkdir(certDir, { recursive: true });
  await Promise.all([
    fs.promises.writeFile(keyPath, key),
    fs.promises.writeFile(certPath, cert),
  ]);
  console.log("  ...done!");

  return {
    key,
    cert,
  };
};

export default getCertFromLetsencrypt;
