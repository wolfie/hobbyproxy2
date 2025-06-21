import ApiServer from "./lib/ApiServer.ts";
import CertManager from "./lib/cert-manager/CertManager.ts";
import CurrentIpTracker from "./lib/CurrentIpTracker.ts";
import DnsManager from "./lib/DnsManager.ts";

const currentIpTracker = await CurrentIpTracker.create();
const dnsManager = await DnsManager.create(currentIpTracker);
await dnsManager.verifyDnsRecords();

const certManager = await CertManager.create(dnsManager);
const server = new ApiServer(certManager);

server.start();
