import Cloudflare from "cloudflare";
import env from "./env.ts";
import type { DnsTxtRecordModifier } from "./cert-manager/getCertFromLetsencrypt.ts";
import type CurrentIpTracker from "./CurrentIpTracker.ts";

const showAllZones = async (cloudflare: Cloudflare) => {
  console.log("The zone(s) the API key has access to:");
  for await (const zone of cloudflare.zones.list()) {
    console.log(`${zone.id}: ${zone.name}`);
  }
};

const getZoneId = async (cloudflare: Cloudflare): Promise<string> => {
  let zoneId = env().CLOUDFLARE_ZONE_ID;
  if (zoneId) {
    const exists = await cloudflare.zones
      .get({ zone_id: zoneId })
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return zoneId;
    } else {
      console.log(`CLOUDFLARE_ZONE_ID=${zoneId} is not an available zone.`);
      await showAllZones(cloudflare);
      throw new Error("Invalid zone id");
    }
  } else {
    console.log(`CLOUDFLARE_ZONE_ID is not set`);
    await showAllZones(cloudflare);
    throw new Error("Missing zone id");
  }
};

class DnsManager implements DnsTxtRecordModifier {
  #cloudflare: Cloudflare;
  #zoneId: string;
  #currentIpTracker: CurrentIpTracker;

  static async create(currentIpTracker: CurrentIpTracker) {
    const cloudflareApiToken = env().CLOUDFLARE_API_TOKEN;
    if (!cloudflareApiToken) throw new Error("CLOUDFLARE_API_TOKEN not set");
    const cloudflare = new Cloudflare({ apiToken: cloudflareApiToken });
    const zoneId = await getZoneId(cloudflare);
    return new DnsManager(cloudflare, zoneId, currentIpTracker);
  }

  private constructor(
    cloudflare: Cloudflare,
    zoneId: string,
    currentIpTracker: CurrentIpTracker
  ) {
    this.#cloudflare = cloudflare;
    this.#zoneId = zoneId;
    this.#currentIpTracker = currentIpTracker;
  }

  async setTxtEntry(name: string, content: string): Promise<void> {
    console.log(`Creating TXT DNS entry ${name}`);
    await this.#cloudflare.dns.records.create({
      type: "TXT",
      zone_id: this.#zoneId,
      name,
      content,
      comment: `Created by HobbyProxy @ ${new Date().toISOString()}`,
    });
  }

  async removeAllTxtEntries(name: string): Promise<void> {
    const dnsEntries = this.#cloudflare.dns.records.list({
      zone_id: this.#zoneId,
      type: "TXT",
      name: { exact: name },
    });
    for await (const dnsEntry of dnsEntries) {
      console.log(`Deleting TXT DNS entry ${name} (id:${dnsEntry.id})`);
      await this.#cloudflare.dns.records.delete(dnsEntry.id, {
        zone_id: this.#zoneId,
      });
    }
  }

  async verifyDnsRecords() {
    console.log("Checking for DNS A-records pointing to this server");
    const dnsEntries = this.#cloudflare.dns.records.list({
      zone_id: this.#zoneId,
      name: { endswith: env().DOMAIN_NAME },
      type: "A",
    });

    let hasFoundWildcard = false;
    let hasFoundRoot = false;
    // TODO check that IPs match, too
    for await (const dnsEntry of dnsEntries) {
      const logFound = () => {
        console.log(
          `[${dnsEntry.type}] ${dnsEntry.name} -> ${dnsEntry.content}${
            dnsEntry.proxied ? " (proxied)" : ""
          }`
        );
      };

      if (dnsEntry.name === env().DOMAIN_NAME) {
        hasFoundRoot = true;
        logFound();
      } else if (dnsEntry.name === "*." + env().DOMAIN_NAME) {
        hasFoundWildcard = true;
        logFound();
      } else {
        console.log(`Ignoring ${dnsEntry.name}`);
      }

      if (hasFoundRoot && hasFoundWildcard) break;
    }

    if (!hasFoundWildcard || !hasFoundRoot) {
      console.log("Trying to fix issue.");

      console.log("Checking for possibly conflicting AAAA/CNAME-records");
      const dnsEntries = this.#cloudflare.dns.records.list({
        zone_id: this.#zoneId,
        name: { endswith: env().DOMAIN_NAME },
      });
      let hasConflicts = false;
      for await (const dnsEntry of dnsEntries) {
        if (
          ["AAAA", "CNAME"].includes(dnsEntry.type) &&
          ((!hasFoundRoot && dnsEntry.name === env().DOMAIN_NAME) ||
            (!hasFoundWildcard && dnsEntry.name === `*.${env().DOMAIN_NAME}`))
        ) {
          console.log(
            `Found conflicting record: [${dnsEntry.type}] ${dnsEntry.name}`
          );
          hasConflicts = true;
        }
      }

      if (hasConflicts) {
        throw new Error(
          "Cannot fix DNS record issue automatically. " +
            "Consider deleting the conflicting entry/entries."
        );
      }

      const currentIp = this.#currentIpTracker.get();
      if (!hasFoundRoot) {
        console.log(
          `Found no A-record for ${env().DOMAIN_NAME}. Creating new one.`
        );
        await this.#cloudflare.dns.records.create({
          zone_id: this.#zoneId,
          type: "A",
          name: env().DOMAIN_NAME,
          content: currentIp,
          proxied: true,
          comment: `Created by HobbyProxy @ ${new Date().toISOString()}`,
        });
        console.log("  ...done!");
      }
      if (!hasFoundWildcard) {
        console.log(
          `Found no A-record for *.${env().DOMAIN_NAME}. Creating new one.`
        );
        await this.#cloudflare.dns.records.create({
          zone_id: this.#zoneId,
          type: "A",
          name: `*.${env().DOMAIN_NAME}`,
          content: currentIp,
          proxied: true,
          comment: `Created by HobbyProxy @ ${new Date().toISOString()}`,
        });
        console.log("  ...done!");
      }
    }
  }
}

export default DnsManager;
