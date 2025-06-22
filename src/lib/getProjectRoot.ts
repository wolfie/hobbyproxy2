import { findPackageJSON } from "node:module";
import path from "node:path";

const getProjectRoot = () => {
  const packageJsonPath = findPackageJSON(import.meta.url);
  if (!packageJsonPath) throw new Error("Could not find project root");
  return path.dirname(packageJsonPath);
};

export default getProjectRoot;
