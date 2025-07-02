import getFileInput from "./getFileInput";

const getFile = () => {
  const input = getFileInput();
  const file = input.files?.[0];
  if (!file) {
    window.alert("No file");
    throw new Error("No file");
  }
  return file;
};
export default getFile;
