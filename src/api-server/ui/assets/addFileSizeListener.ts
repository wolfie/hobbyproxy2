import getFile from "./getFile";
import getFileInput from "./getFileInput";

const getFileSize = (bytes: number) => {
  const SIZES = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes > 1024 && i < SIZES.length) {
    bytes /= 1024;
    i++;
  }
  return `${Math.round(bytes * 100) / 100}${SIZES[i]}`;
};

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onerror = reject;
    reader.onload = () => {
      if (!reader.result) {
        window.alert("Result of file reading was null");
        return;
      }
      if (typeof reader.result !== "string") {
        window.alert("Result of file reading was not string");
        return;
      }
      return resolve(reader.result.split(",")[1]);
    };
  });

const updateFileInfo = async (file: File) => {
  const fileSizeDiv = document.querySelector<HTMLDivElement>("#filesize");
  if (!fileSizeDiv) {
    window.alert("Can't find file size div");
    return;
  }

  const base64 = await fileToBase64(file);
  fileSizeDiv.textContent = `${getFileSize(file.size)} (${getFileSize(base64.length)} in base64)`;

  const hiddenInput = document.createElement("input");
  hiddenInput.setAttribute("type", "hidden");
  hiddenInput.setAttribute("name", "fileBase64");
  hiddenInput.value = base64;
  fileSizeDiv.appendChild(hiddenInput);
};

const addFileSizeListener = () => {
  const fileInput = getFileInput();
  const initialFile = fileInput.files?.[0];
  if (initialFile) updateFileInfo(initialFile);

  fileInput.addEventListener("change", () => updateFileInfo(getFile()));
};

export default addFileSizeListener;
