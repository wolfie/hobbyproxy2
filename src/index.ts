import { Command, Option } from "@commander-js/extra-typings";

import { format } from "node:util";
import ApiServer from "./api-server/ApiServer.ts";
import CertManager from "./cert-manager/CertManager.ts";
import CurrentIpTracker from "./current-ip-tracker/CurrentIpTracker.ts";
import DnsManager from "./dns-manager/DnsManager.ts";
import LogSpan from "./logger/LogSpan.ts";
import ProxyManager from "./proxy-manager/ProxyManager.ts";

const options = new Command("hobbyproxy")
  .addOption(
    new Option(
      "--startup-challenge <action>",
      "What to do with the DNS-verification step at startup?",
    )
      .choices(["error", "ignore", "skip"])
      .default("error"),
  )
  .showHelpAfterError()
  .parse()
  .opts();

const errorCatcher = (topic: string) => async (e: unknown) => {
  const span = new LogSpan(topic);
  span.log("PROCESS", format(e));
  await span.end();
  // throw e; // DO NOT THROW HERE! Leads to infinite loop
  process.exit(1);
};

process.addListener("uncaughtException", errorCatcher("Uncaught Exception"));
process.addListener("unhandledRejection", errorCatcher("Unhandled Rejection"));

const span = new LogSpan("Startup");

const currentIpTracker = await CurrentIpTracker.create(span);
const dnsManager = await DnsManager.create(currentIpTracker, span);
await dnsManager.verifyDnsRecords(span);

const certManager = await CertManager.create(dnsManager, span);
const proxyManager = await ProxyManager.create(span);
const server = new ApiServer(certManager, proxyManager, {
  startupChallenge: options.startupChallenge,
});

await server.start(span);

span.end();
