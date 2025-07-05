import type ProxyManager from "../../../proxy-manager/ProxyManager";
import type { DeleteBody, PostBody } from "../../ApiServer";
import addFileChangeListener from "./addFileSizeListener";
import getFile from "./getFile";

type GetRootResponse = ReturnType<ProxyManager["getRoutes"]>;

const getInputValue = (form: HTMLFormElement, name: string) => {
  const e = form.elements.namedItem(name);
  if (!(e instanceof HTMLInputElement)) {
    window.alert(`Can't find ${name}`);
    throw new Error(`Can't find ${name}`);
  }
  if (!e.value) {
    window.alert(`Value of ${name} is empty`);
    throw new Error(`Value of ${name} is empty`);
  }
  return e.value;
};

const populateHosts = async () => {
  const currentRoutesButton = document.querySelector("#current-routes-button");
  currentRoutesButton?.setAttribute("disabled", "");
  const response = await fetch("/").finally(() =>
    currentRoutesButton?.removeAttribute("disabled"),
  );
  const json: GetRootResponse = await response.json();
  const currentRoutesDiv =
    document.querySelector<HTMLDivElement>("#current-routes");
  if (!currentRoutesDiv) {
    window.alert("Could not find #current-routes");
    return;
  }

  if (json.length === 0) {
    currentRoutesDiv.innerHTML = "<b>No routes yet</b>";
    return;
  }

  const ul = document.createElement("ul");
  ul.append(
    ...json.map((route) => {
      const li = document.createElement("li");
      li.innerHTML = `<div>${route.host} <button>x</button></div>`;
      li.querySelector("button")?.addEventListener("click", () => {
        const confirm = window.confirm(`Delete route to ${route.host}?`);
        if (confirm) {
          fetch("/", {
            method: "delete",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              hostname: route.host,
            } satisfies DeleteBody),
          }).then(populateHosts);
        }
      });
      return li;
    }),
  );

  currentRoutesDiv.innerHTML = "";
  currentRoutesDiv.appendChild(ul);
};

const init = () => {
  document
    .querySelector("#current-routes-button")
    ?.addEventListener("click", () => populateHosts());

  addFileChangeListener();

  populateHosts();

  const form = document.querySelector("form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const base64 = getInputValue(form, "fileBase64");
    const hostname = getInputValue(form, "hostname");
    const file = getFile();

    form.reset();
    const filesize = document.querySelector("#filesize");
    if (filesize) filesize.innerHTML = "";

    fetch("/", {
      method: "post",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 3,
        type: "zip",
        hostname,
        filename: file.name,
        contents: base64,
      } satisfies PostBody),
    }).finally(populateHosts);
  });
};

init();
