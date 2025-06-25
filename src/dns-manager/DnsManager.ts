import Cloudflare from "cloudflare";

import type CurrentIpTracker from "../current-ip-tracker/CurrentIpTracker.ts";
import env from "../env.ts";
import type LogSpan from "../logger/LogSpan.ts";
import { flushAllBuffers } from "../logger/NtfyBuffer.ts";

const showAllZones = async (cloudflare: Cloudflare, span: LogSpan) => {
  span.logNoNtfy("DNS", "The zone(s) the API key has access to:");
  for await (const zone of cloudflare.zones.list()) {
    span.logNoNtfy("DNS", `${zone.id}: ${zone.name}`);
  }
};

const getZoneId = async (
  cloudflare: Cloudflare,
  span: LogSpan,
): Promise<string> => {
  const zoneId = env().CLOUDFLARE_ZONE_ID;
  if (zoneId) {
    const exists = await cloudflare.zones
      .get({ zone_id: zoneId })
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return zoneId;
    } else {
      span.log("DNS", `CLOUDFLARE_ZONE_ID=${zoneId} is not an available zone.`);
      await showAllZones(cloudflare, span);
      throw new Error("Invalid zone id");
    }
  } else {
    span.log("DNS", `CLOUDFLARE_ZONE_ID is not set`);
    await showAllZones(cloudflare, span);
    await flushAllBuffers();
    process.exit(1);
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

class DnsManager {
  #cloudflare: Cloudflare;
  #zoneId: string;
  #currentIpTracker: CurrentIpTracker;

  static async create(currentIpTracker: CurrentIpTracker, span: LogSpan) {
    const cloudflareApiToken = env().CLOUDFLARE_API_TOKEN;
    if (!cloudflareApiToken) throw new Error("CLOUDFLARE_API_TOKEN not set");
    const cloudflare = new Cloudflare({ apiToken: cloudflareApiToken });
    const zoneId = await getZoneId(cloudflare, span);
    return new DnsManager(cloudflare, zoneId, currentIpTracker, span);
  }

  private constructor(
    cloudflare: Cloudflare,
    zoneId: string,
    currentIpTracker: CurrentIpTracker,
    span: LogSpan,
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

        span.log(
          "DNS",
          `Updating DNS A-record for ${record.name} with new IP ${newIp}`,
        );
        await this.#cloudflare.dns.records.update(record.id, {
          ...record,
          zone_id: zoneId,
          content: newIp,
        });
        span.log("DNS", "  ...done!");
      }
    });
  }

  async setTxtRecord(
    name: string,
    content: string,
    span: LogSpan,
  ): Promise<void> {
    span.logNoNtfy("DNS", `Creating TXT DNS entry ${name}`);
    await this.#cloudflare.dns.records.create({
      type: "TXT",
      zone_id: this.#zoneId,
      name,
      content,
      comment: `Created by HobbyProxy @ ${new Date().toISOString()}`,
    });
  }

  async removeAllTxtRecords(name: string, span: LogSpan): Promise<void> {
    const dnsEntries = this.#cloudflare.dns.records.list({
      zone_id: this.#zoneId,
      type: "TXT",
      name: { exact: name },
    });
    for await (const dnsEntry of dnsEntries) {
      span.logNoNtfy(
        "DNS",
        `Deleting TXT DNS entry ${name} (id:${dnsEntry.id})`,
      );
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

  async verifyDnsRecords(span: LogSpan) {
    span.logNoNtfy("DNS", "Checking for DNS A-records pointing to this server");
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
        span.log(
          "DNS",
          `Internal Error: Unexpected record of type ${record.type} found (id:${record.id})`,
        );
        continue;
      }

      const logFound = () => {
        span.log(
          "DNS",
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
        span.log("DNS", `Ignoring ${record.name}`);
      }

      if (rootChecks.found && wildcardChecks.found) break;
    }

    if (hasIssues(wildcardChecks, rootChecks)) {
      span.log("DNS", "Trying to fix issue(s).");
      for (const checks of [wildcardChecks, rootChecks]) {
        await this.fixIssues(checks, span);
      }
    }
  }

  private async fixIssues(checks: Checks, span: LogSpan) {
    if (checks.found && checks.ipMatches) return;

    if (!checks.found) {
      span.log(
        "DNS",
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
          span.log(
            "DNS",
            `Found conflicting record: [${entry.type}] ${entry.name}`,
          );
          span.log(
            "DNS",
            "Cannot fix DNS record issue automatically. Consider deleting the conflicting entry.",
          );
          await flushAllBuffers();
          process.exit(1);
        }
      }
      this.setARecord(checks.domain);
    } else if (!checks.ipMatches) {
      span.log(
        "DNS",
        `Updating DNS A-record ` +
          `for ${checks.domain} to ` +
          `point to current IP: ${this.#currentIpTracker.get()}...`,
      );
      await this.#cloudflare.dns.records.update(checks.dnsRecord.id, {
        ...checks.dnsRecord,
        zone_id: this.#zoneId,
        content: this.#currentIpTracker.get(),
      });
      span.log("DNS", "  ...done!");
    }
  }
}

export default DnsManager;
