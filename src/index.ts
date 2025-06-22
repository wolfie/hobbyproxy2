import ApiServer from "./api-server/ApiServer.ts";
import CertManager from "./cert-manager/CertManager.ts";
import CurrentIpTracker from "./current-ip-tracker/CurrentIpTracker.ts";
import DnsManager from "./dns-manager/DnsManager.ts";
import ProxyManager from "./proxy-manager/ProxyManager.ts";

const currentIpTracker = await CurrentIpTracker.create();
const dnsManager = await DnsManager.create(currentIpTracker);
await dnsManager.verifyDnsRecords();

const certManager = await CertManager.create(dnsManager);
const proxyManager = await ProxyManager.create();
const server = new ApiServer(certManager, proxyManager);

server.start();
