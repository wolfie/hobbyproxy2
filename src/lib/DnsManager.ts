import Cloudflare from "cloudflare";
import env from "./env.ts";
import type { DnsTxtRecordModifier } from "./cert-manager/getCertFromLetsencrypt.ts";

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

  static async create() {
    const cloudflareApiToken = env().CLOUDFLARE_API_TOKEN;
    if (!cloudflareApiToken) throw new Error("CLOUDFLARE_API_TOKEN not set");
    const cloudflare = new Cloudflare({ apiToken: cloudflareApiToken });
    const zoneId = await getZoneId(cloudflare);
    return new DnsManager(cloudflare, zoneId);
  }

  private constructor(cloudflare: Cloudflare, zoneId: string) {
    this.#cloudflare = cloudflare;
    this.#zoneId = zoneId;
  }

  async setTxtEntry(name: string, content: string): Promise<void> {
    console.log(`Creating TXT DNS entry ${name}`);
    return this.#cloudflare.dns.records
      .create({ type: "TXT", zone_id: this.#zoneId, name, content })
      .then();
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
}

export default DnsManager;
