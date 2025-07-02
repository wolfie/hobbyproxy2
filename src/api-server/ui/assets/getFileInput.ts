const getFileInput = () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    window.alert("Can't find file input");
    throw new Error("Can't find file input");
  }
  return input;
};

export default getFileInput;
