const getCurrentIp = async (): Promise<string | undefined> => {
  try {
    const response = await fetch("https://api.ipify.org/");
    const text = await response.text();
    if (response.status !== 200) {
      console.error(`api.ipify.org responded with HTTP ${response.status}`);
      console.error(text);
      return undefined;
    }

    return text;
  } catch (e) {
    console.error("Error while accessing api.ipify.org");
    console.error(e);
    return undefined;
  }
};

const TEN_MINUTES_MS = 10 * 60 * 1000;

export type IpChangeListener = (newIp: string) => void;

class CurrentIpTracker {
  #currentIp: string;
  #listeners: IpChangeListener[] = [];

  static async create() {
    const initialIp = await getCurrentIp();
    if (!initialIp) {
      throw new Error("Could not get initial IP");
    }
    console.log(`Initial IP is ${initialIp}`);
    return new CurrentIpTracker(initialIp);
  }

  private constructor(currentIp: string) {
    this.#currentIp = currentIp;
    setInterval(async () => {
      const currentIp = await getCurrentIp();
      if (currentIp && currentIp !== this.#currentIp) {
        console.log(`IP has changed to ${currentIp}`);
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
