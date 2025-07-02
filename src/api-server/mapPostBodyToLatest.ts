import type { Request } from "express";
import type { PostBody, PostBodyLatest } from "./ApiServer.ts";
import mapBodyLegacyToV2, {
  type MapLegacyToV2Error,
} from "./mapPostBodyToLatest.legacy.ts";
import mapBodyV2ToV3 from "./mapPostBodyToLatest.v2.ts";

export type MapPostBodySuccess<CONVERTED_VERSION extends PostBody> = {
  success: true;
  data: CONVERTED_VERSION;
};
type MapPostBodyError =
  | MapLegacyToV2Error
  | {
      success: false;
      step?: undefined;
      error: "internal-error";
      details: string;
    };

const mapPostBodyToLatest = (
  postBody: PostBody,
  req: Request,
): MapPostBodySuccess<PostBodyLatest> | MapPostBodyError => {
  if (typeof postBody.version === "undefined") {
    const result = mapBodyLegacyToV2(postBody, req);
    if (!result.success) return result;
    postBody = result.data;
  }

  if (postBody.version === 2) {
    const result = mapBodyV2ToV3(postBody);
    if (!result.success) return result;
    postBody = result.data;
  }

  if (postBody.version !== 3) {
    return {
      success: false,
      error: "internal-error",
      details:
        "For some reason, migrating to the latest post body version failed.",
    };
  }

  return {
    success: true,
    data: postBody,
  };
};

export default mapPostBodyToLatest;
