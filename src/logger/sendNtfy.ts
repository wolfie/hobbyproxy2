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

const sendNtfy = (url: URL, message: NtfyMessage) =>
  fetch(url, {
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify(message),
  });

export default sendNtfy;
