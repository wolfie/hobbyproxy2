import type { Request } from "express";

import type { PostBodyLegacy, PostBodyV2 } from "./ApiServer.ts";
import type { MapPostBodySuccess } from "./mapPostBodyToLatest.ts";

export type MapLegacyToV2Error = {
  success: false;
  step: "legacy->v2";
  error: "bad-hostname";
  details: string;
};

const mapBodyLegacyToV2 = (
  body: PostBodyLegacy,
  req: Request,
): MapPostBodySuccess<PostBodyV2> | MapLegacyToV2Error => {
  const expires = new Date();
  expires.setDate(expires.getDate() + (body.staleInDays ?? 7));

  const parts = body.target.split(":", 2) as [string, string | undefined];

  const targetHostname = parts[0] ? parts[0] : req.socket.remoteAddress;
  const targetPort = typeof parts[1] !== "undefined" ? parseInt(parts[1]) : 80;

  if (!targetHostname) {
    return {
      success: false,
      step: "legacy->v2",
      error: "bad-hostname",
      details: `Could not parse a hostname from ${body.target} (also req.socket.remoteAddress was empty)`,
    };
  }

  return {
    success: true,
    data: {
      version: 2,
      expires,
      hostname: body.hostname,
      target: { hostname: targetHostname, port: targetPort },
    },
  };
};

export default mapBodyLegacyToV2;
