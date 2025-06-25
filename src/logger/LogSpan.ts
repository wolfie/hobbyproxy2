import NtfyBuffer from "./NtfyBuffer.ts";

type System = "IP" | "DNS" | "CERT" | "PROXY" | "PROCESS" | "API";

class LogSpan implements AsyncDisposable {
  #ntfy: NtfyBuffer;
  #topic: string;
  #done = false;

  constructor(topic: string) {
    this.#topic = topic;
    this.#ntfy = new NtfyBuffer(topic);
  }

  log(system: System, message: string) {
    if (this.#done) return this;
    this.#ntfy.add(`[${system}] ${message}`);
    console.log(`${this.#topic}: [${system}] ${message}`);
    return this;
  }

  logNoNtfy(system: System, message: string) {
    if (this.#done) return this;
    console.log(`${this.#topic}: [${system}] ${message}`);
    return this;
  }

  end() {
    this.#done = true;
    return this.#ntfy.flush();
  }

  async [Symbol.asyncDispose]() {
    this.#done = true;
    await this.#ntfy[Symbol.asyncDispose]();
  }
}

export default LogSpan;
