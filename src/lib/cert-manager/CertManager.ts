import { findPackageJSON } from "node:module";
import type { CertInfo, CertProvider } from "../ApiServer.ts";
import path from "node:path";
import getCertInfoFromDisk from "./getCertInfoFromDisk.ts";
import getCertFromLetsencrypt, {
  type DnsTxtRecordModifier,
} from "./getCertFromLetsencrypt.ts";

const packageJsonPath = findPackageJSON(import.meta.url);
if (!packageJsonPath) throw new Error("Could not find project root");
const CERT_DIR = path.resolve(path.dirname(packageJsonPath), "cert");

class CertManager implements CertProvider {
  #certInfo: Readonly<CertInfo>;

  static async create(dnsTxtRecordModifier: DnsTxtRecordModifier) {
    let certInfo = await getCertInfoFromDisk(CERT_DIR);
    if (!certInfo) {
      console.log(
        "Cert info not found on disk, acquiring new from LetsEncrypt"
      );

      certInfo = await getCertFromLetsencrypt(CERT_DIR, dnsTxtRecordModifier);
    }

    return new CertManager(certInfo);
  }

  private constructor(certInfo: CertInfo) {
    this.#certInfo = Object.freeze(certInfo);
  }

  getSslCert() {
    return this.#certInfo;
  }
}

export default CertManager;
