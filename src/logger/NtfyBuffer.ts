import env from "../env.ts";
import $sendNtfy, { type NtfyMessage } from "./sendNtfy.ts";

const NTFY_URL = new URL(env().NTFY_SERVER ?? "https://ntfy.sh");
const NTFY_TOPIC = env().NTFY_TOPIC;
type NtfySender = (message: Omit<NtfyMessage, "topic">) => Promise<void>;

const createSendNtfy = (url: URL, topic: string | undefined): NtfySender => {
  if (!topic) {
    console.log("NTFY_TOPIC not set, not using ntfy.sh for notifications.");
    return () => Promise.resolve(undefined);
  } else {
    console.log(
      `Using server ${url} and topic ${topic} for ntfy.sh notifications.`,
    );
    return (message) => $sendNtfy(url, { topic, ...message }).then();
  }
};

const sendNtfy = createSendNtfy(NTFY_URL, NTFY_TOPIC);

const allBuffers: NtfyBuffer[] = [];
export const flushAllBuffers = async () => {
  if (allBuffers.length === 0) return;

  console.log(`Flushing ${allBuffers.length} buffers...`);
  await Promise.all(allBuffers.map((buffer) => buffer.flush()));
  console.log(`  ...done!`);
};

class NtfyBuffer implements AsyncDisposable {
  #messages: string[] = [];
  #flushed = false;
  #topic: string;

  constructor(topic: string) {
    this.#topic = topic;
    allBuffers.push(this);
  }

  add(str: string) {
    this.#messages.push(str);
  }

  flush() {
    if (this.#flushed) return Promise.resolve(undefined);

    allBuffers.splice(allBuffers.indexOf(this), 1);
    this.#flushed = true;

    if (this.#messages.length === 0) return Promise.resolve(undefined);

    return sendNtfy({
      title: this.#topic,
      message: this.#messages.join("\n"),
    });
  }

  async [Symbol.asyncDispose]() {
    await this.flush();
  }
}

export default NtfyBuffer;
