import Cloudflare from "cloudflare";

import type { DnsTxtRecordModifier } from "../cert-manager/getCertFromLetsencrypt.ts";
import type CurrentIpTracker from "../current-ip-tracker/CurrentIpTracker.ts";
import env from "../lib/env.ts";

const showAllZones = async (cloudflare: Cloudflare) => {
  console.log("The zone(s) the API key has access to:");
  for await (const zone of cloudflare.zones.list()) {
    console.log(`${zone.id}: ${zone.name}`);
  }
};

const getZoneId = async (cloudflare: Cloudflare): Promise<string> => {
  const zoneId = env().CLOUDFLARE_ZONE_ID;
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

type Checks =
  | {
      found: false;
      domain: string;
      dnsRecord?: undefined;
      ipMatches?: undefined;
    }
  | {
      found: true;
      domain: string;
      dnsRecord: Cloudflare.DNS.Records.RecordResponse.ARecord;
      ipMatches: boolean;
    };
const hasIssues = (...statuses: Checks[]) =>
  statuses.some((s) => !s.found || !s.ipMatches);

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
    currentIpTracker: CurrentIpTracker,
  ) {
    this.#cloudflare = cloudflare;
    this.#zoneId = zoneId;
    this.#currentIpTracker = currentIpTracker;

    currentIpTracker.onIpChange(async (newIp) => {
      const records = this.#cloudflare.dns.records.list({
        zone_id: zoneId,
        type: "A",
        name: { endswith: env().DOMAIN_NAME },
      });
      for await (const record of records) {
        if (
          record.type !== "A" ||
          ![env().DOMAIN_NAME, `*.${env().DOMAIN_NAME}`].includes(record.name)
        ) {
          continue;
        }

        console.log(
          `Updating DNS A-record for ${record.name} with new IP ${newIp}`,
        );
        await this.#cloudflare.dns.records.update(record.id, {
          ...record,
          zone_id: zoneId,
          content: newIp,
        });
        console.log("  ...done!");
      }
    });
  }

  async setTxtRecord(name: string, content: string): Promise<void> {
    console.log(`Creating TXT DNS entry ${name}`);
    await this.#cloudflare.dns.records.create({
      type: "TXT",
      zone_id: this.#zoneId,
      name,
      content,
      comment: `Created by HobbyProxy @ ${new Date().toISOString()}`,
    });
  }

  async removeAllTxtRecords(name: string): Promise<void> {
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

  async setARecord(domain: string) {
    await this.#cloudflare.dns.records.create({
      zone_id: this.#zoneId,
      type: "A",
      name: domain,
      content: this.#currentIpTracker.get(),
      proxied: true,
      comment: `Created by HobbyProxy @ ${new Date().toISOString()}`,
    });
  }

  async verifyDnsRecords() {
    console.log("Checking for DNS A-records pointing to this server");
    const records = this.#cloudflare.dns.records.list({
      zone_id: this.#zoneId,
      name: { endswith: env().DOMAIN_NAME },
      type: "A",
    });

    let wildcardChecks: Checks = {
      domain: `*.${env().DOMAIN_NAME}`,
      found: false,
    };
    let rootChecks: Checks = {
      domain: env().DOMAIN_NAME,
      found: false,
    };
    for await (const record of records) {
      if (record.type !== "A") {
        console.error(
          `Internal Error: Unexpected record of type ${record.type} found (id:${record.id})`,
        );
        continue;
      }

      const logFound = () => {
        console.log(
          `[${record.type}] ${record.name} -> ${record.content}${
            record.proxied ? " (proxied)" : ""
          }`,
        );
      };

      if (record.name === env().DOMAIN_NAME) {
        rootChecks = {
          found: true,
          domain: env().DOMAIN_NAME,
          dnsRecord: record,
          ipMatches: record.content === this.#currentIpTracker.get(),
        };
        logFound();
      } else if (record.name === "*." + env().DOMAIN_NAME) {
        wildcardChecks = {
          found: true,
          domain: `*.${env().DOMAIN_NAME}`,
          dnsRecord: record,
          ipMatches: record.content === this.#currentIpTracker.get(),
        };
        logFound();
      } else {
        console.log(`Ignoring ${record.name}`);
      }

      if (rootChecks.found && wildcardChecks.found) break;
    }

    if (hasIssues(wildcardChecks, rootChecks)) {
      console.log("Trying to fix issue(s).");
      for (const checks of [wildcardChecks, rootChecks]) {
        await this.fixIssues(checks);
      }
    }
  }

  private async fixIssues(checks: Checks) {
    if (checks.found && checks.ipMatches) return;

    if (!checks.found) {
      console.log(
        `Checking for possibly conflicting AAAA/CNAME-records on ${checks.domain}`,
      );
      const entries = this.#cloudflare.dns.records.list({
        zone_id: this.#zoneId,
        name: { exact: checks.domain },
      });
      for await (const entry of entries) {
        if (
          ["AAAA", "CNAME"].includes(entry.type) &&
          entry.name === checks.domain
        ) {
          console.error(
            `Found conflicting record: [${entry.type}] ${entry.name}`,
          );
          throw new Error(
            "Cannot fix DNS record issue automatically. " +
              "Consider deleting the conflicting entry.",
          );
        }
      }
      this.setARecord(checks.domain);
    } else if (!checks.ipMatches) {
      console.log(
        `Updating DNS A-record ` +
          `for ${checks.domain} to ` +
          `point to current IP: ${this.#currentIpTracker.get()}...`,
      );
      await this.#cloudflare.dns.records.update(checks.dnsRecord.id, {
        ...checks.dnsRecord,
        zone_id: this.#zoneId,
        content: this.#currentIpTracker.get(),
      });
      console.log("  ...done!");
    }
  }
}

export default DnsManager;
