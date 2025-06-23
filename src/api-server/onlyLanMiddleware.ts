import type { RequestHandler } from "express";

import isLanAddress from "./isLanAddress.ts";

const onlyLanMiddleware: RequestHandler = (req, res, next) => {
  if (isLanAddress(req.hostname)) next();
  else next("route");
};

export default onlyLanMiddleware;
