const isLanAddress = (hostname: string | undefined): boolean => {
  if (typeof hostname === "undefined") return false; // for some reason `req.hostname` can be undefined.

  const isPrivateIP =
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || // 10.0.0.0 - 10.255.255.255
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) || // 172.16.0.0 - 172.31.255.255
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname); // 192.168.0.0 - 192.168.255.255

  const isLocalhost =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1";

  return isPrivateIP || isLocalhost;
};

export default isLanAddress;
