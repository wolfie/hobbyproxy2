import { format } from "node:util";

import LogSpan from "../logger/LogSpan.ts";
import { flushAllBuffers } from "../logger/NtfyBuffer.ts";

const getCurrentIp = async (span: LogSpan): Promise<string | undefined> => {
  try {
    const response = await fetch("https://api.ipify.org/");
    const text = await response.text();
    if (response.status !== 200) {
      span.log(
        "IP",
        `api.ipify.org responded with HTTP ${response.status}\n${text}`,
      );
      return undefined;
    }

    return text;
  } catch (e) {
    span.log("IP", `Error while accessing api.ipify.org\n${format(e)}`);
    return undefined;
  }
};

const TEN_MINUTES_MS = 10 * 60 * 1000;

export type IpChangeListener = (newIp: string) => void;

class CurrentIpTracker {
  #currentIp: string;
  #listeners: IpChangeListener[] = [];

  static async create(span: LogSpan) {
    const initialIp = await getCurrentIp(span);
    if (!initialIp) {
      span.log("IP", "‼️ Could not get initial IP");
      await flushAllBuffers();
      process.exit(1);
    }
    span.log("IP", `Initial IP is ${initialIp}`);
    return new CurrentIpTracker(initialIp);
  }

  private constructor(currentIp: string) {
    this.#currentIp = currentIp;
    setInterval(async () => {
      await using span = new LogSpan("IP refresh");
      const currentIp = await getCurrentIp(span);
      if (currentIp && currentIp !== this.#currentIp) {
        span.log("IP", `IP has changed to ${currentIp}`);
        this.#currentIp = currentIp;
        this.#listeners.forEach((cb) => cb(currentIp));
      }
    }, TEN_MINUTES_MS);
  }

  get() {
    return this.#currentIp;
  }

  onIpChange(cb: IpChangeListener) {
    this.#listeners.push(cb);
  }
}

export default CurrentIpTracker;
