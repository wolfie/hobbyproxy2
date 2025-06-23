import { Command, Option } from "@commander-js/extra-typings";

import ApiServer from "./api-server/ApiServer.ts";
import CertManager from "./cert-manager/CertManager.ts";
import CurrentIpTracker from "./current-ip-tracker/CurrentIpTracker.ts";
import DnsManager from "./dns-manager/DnsManager.ts";
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

const currentIpTracker = await CurrentIpTracker.create();
const dnsManager = await DnsManager.create(currentIpTracker);
await dnsManager.verifyDnsRecords();

const certManager = await CertManager.create(dnsManager);
const proxyManager = await ProxyManager.create();
const server = new ApiServer(certManager, proxyManager, {
  startupChallenge: options.startupChallenge,
});

server.start();
