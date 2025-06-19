import ApiServer from "./lib/ApiServer.ts";
import CertManager from "./lib/cert-manager/CertManager.ts";

const certManager = await CertManager.create();
const server = new ApiServer(certManager);
server.start();
