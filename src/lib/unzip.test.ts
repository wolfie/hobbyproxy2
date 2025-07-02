import { describe, expect, it } from "vitest";
import unzip from "./unzip.ts";

const STRING_BUFFER = Buffer.from("dGhpcyBzdHJpbmcgaXMgdmFsaWQK", "base64");
const ZIP_BUFFER = Buffer.from(
  "UEsDBAoAAAAAAE215FoAAAAAAAAAAAAAAAAFABwAYS50eHRVVAkAA6EuaGihLmhodXgLAAEE6AMA" +
    "AAToAwAAUEsBAh4DCgAAAAAATbXkWgAAAAAAAAAAAAAAAAUAGAAAAAAAAAAAAKSBAAAAAGEudHh0" +
    "VVQFAAOhLmhodXgLAAEE6AMAAAToAwAAUEsFBgAAAAABAAEASwAAAD8AAAAAAA==",
  "base64",
);

describe("unzip", () => {
  it("throws on invalid buffer", async () => {
    await expect(() => unzip(STRING_BUFFER)).rejects.toThrow();
  });

  it("accepts a valid buffer", async () => {
    const result = await unzip(ZIP_BUFFER);
    expect(Object.keys(result)).toEqual(["a.txt"]);
    expect(result["a.txt"]).toEqual(Buffer.from(""));
  });
});
