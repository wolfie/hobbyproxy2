import type { PostBodyV2, PostBodyV3 } from "./ApiServer.ts";
import type { MapPostBodySuccess } from "./mapPostBodyToLatest.ts";

const mapBodyV2ToV3 = (
  mapBody: PostBodyV2,
): MapPostBodySuccess<PostBodyV3> => ({
  success: true,
  data: {
    type: "http",
    ...mapBody,
    version: 3,
  },
});

export default mapBodyV2ToV3;
