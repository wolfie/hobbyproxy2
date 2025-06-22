import type { RequestHandler } from "express";
import isLanAddress from "./isLanAddress.ts";

const upgradeToHttpsMiddleware: RequestHandler = (req, res, next) =>
  req.secure || isLanAddress(req.hostname)
    ? next()
    : res.redirect("https://" + req.hostname + req.originalUrl);

export default upgradeToHttpsMiddleware;
