type ViewAction = {
  action: "view";
  label: string;
  url: URL;
  clear?: boolean;
};

type HttpAction = {
  action: "http";
  label: string;
  url: URL;
  method?: "POST" | "GET" | "PUT";
  headers?: Record<string, string>;
  body?: string;
  clear?: boolean;
};

type BroadcastAction = {
  action: "broadcast";
  label: string;
  intent?: string;
  extras?: Record<string, string>;
  clear?: boolean;
};

type Action = ViewAction | HttpAction | BroadcastAction;

/** @link https://docs.ntfy.sh/publish/#publish-as-json */
export type NtfyMessage = {
  topic: string;
  message: string;
  title?: string;
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  actions?: Action[];
  click?: URL;
  attach?: URL;
  markdown?: boolean;
  icon?: URL;
  filename?: string;
  delay?: string;
  email?: string;
  call?: string;
};

type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};
interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}
type DeepReadonly<T> = T extends (infer R)[]
  ? DeepReadonlyArray<R>
  : T extends Function
    ? T
    : T extends object
      ? DeepReadonlyObject<T>
      : T;

type BufferEntry = {
  url: URL; // Technically not needed, but since the function accepts urls, let's keep it
  message: DeepReadonly<NtfyMessage>;
};
const MESSAGE_BUFFER: BufferEntry[] = [];

const $sendNtfy = (url: URL, message: DeepReadonly<NtfyMessage>) =>
  fetch(url, {
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify(message),
  });

const RETRIES = 10;

type SendNtfyResult =
  | { success: true }
  | { success: false; cause: "failed"; retryPromise: Promise<void> }
  | { success: false; cause: "retrying"; queueSize: number };

const retrySendNtfy = async (
  url: URL,
  message: DeepReadonly<NtfyMessage>,
): Promise<void> => {
  const { resolve, reject, promise } = Promise.withResolvers<void>();
  MESSAGE_BUFFER.push({ message, url });

  let retriesLeft = RETRIES;
  const interval = setInterval(async () => {
    while (MESSAGE_BUFFER.length > 0) {
      try {
        const { url, message } = MESSAGE_BUFFER.at(0)!;
        await $sendNtfy(url, message);
        MESSAGE_BUFFER.shift();
      } catch (e) {
        retriesLeft--;
        break;
      }
    }

    if (retriesLeft <= 0) {
      reject(new Error("Out of retries"));
      MESSAGE_BUFFER.splice(0, MESSAGE_BUFFER.length);
      clearInterval(interval);
    }

    if (MESSAGE_BUFFER.length <= 0) {
      resolve();
      clearInterval(interval);
    }
  }, 60_000 / RETRIES);

  return promise;
};

const sendNtfy = async (
  url: URL,
  message: DeepReadonly<NtfyMessage>,
): Promise<SendNtfyResult> => {
  if (MESSAGE_BUFFER.length === 0) {
    try {
      await $sendNtfy(url, message);
      return { success: true };
    } catch (e) {
      return {
        success: false,
        cause: "failed",
        retryPromise: retrySendNtfy(url, message),
      };
    }
  } else {
    MESSAGE_BUFFER.push({ url, message });
    return {
      success: false,
      cause: "retrying",
      queueSize: MESSAGE_BUFFER.length,
    };
  }
};

export default sendNtfy;
