import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import staticZipRoute from "./staticZipRoute.ts";

/**
- /a.txt 
- /index.html
- /b/b.txt
- /c/c.txt
- /c/index.html
*/
const TEST_ZIP_BUFFER = Buffer.from(
  "UEsDBAoAAgAAAFGm5FoMTP5QBgAAAAYAAAAFABwAYS50eHRVVAkAA2kUaGhpFGhodXgLAAEE6AMA" +
    "AAToAwAAZmlsZSBBUEsDBAoAAgAAAOmm5FoLScW4IgAAACIAAAAKABwAaW5kZXguaHRtbFVUCQAD" +
    "hRVoaIUVaGh1eAsAAQToAwAABOgDAAA8IWRvY3R5cGUgaHRtbD4KPGgxPlJvb3QgRGlyPC9oMT4K" +
    "UEsDBAoAAgAAAFGm5Fq2HffJBgAAAAYAAAAHABwAYi9iLnR4dFVUCQADaRRoaOIVaGh1eAsAAQTo" +
    "AwAABOgDAABmaWxlIEJQSwMECgAAAAAA3KbkWgAAAAAAAAAAAAAAAAIAHABjL1VUCQADcBVoaHAV" +
    "aGh1eAsAAQToAwAABOgDAABQSwMECgACAAAAUabkWiAt8L4GAAAABgAAAAcAHABjL2MudHh0VVQJ" +
    "AANqFGhoahRoaHV4CwABBOgDAAAE6AMAAGZpbGUgQ1BLAwQKAAIAAADlpuRarsVDFR8AAAAfAAAA" +
    "DAAcAGMvaW5kZXguaHRtbFVUCQADfRVoaH0VaGh1eAsAAQToAwAABOgDAAA8IWRvY3R5cGUgaHRt" +
    "bD4KPGgxPkRpciBDPC9oMT4KUEsBAh4DCgACAAAAUabkWgxM/lAGAAAABgAAAAUAGAAAAAAAAQAA" +
    "AKSBAAAAAGEudHh0VVQFAANpFGhodXgLAAEE6AMAAAToAwAAUEsBAh4DCgACAAAA6abkWgtJxbgi" +
    "AAAAIgAAAAoAGAAAAAAAAQAAAKSBRQAAAGluZGV4Lmh0bWxVVAUAA4UVaGh1eAsAAQToAwAABOgD" +
    "AABQSwECHgMKAAIAAABRpuRath33yQYAAAAGAAAABwAYAAAAAAABAAAApIGrAAAAYi9iLnR4dFVU" +
    "BQADaRRoaHV4CwABBOgDAAAE6AMAAFBLAQIeAwoAAAAAANym5FoAAAAAAAAAAAAAAAACABgAAAAA" +
    "AAAAEADtQfIAAABjL1VUBQADcBVoaHV4CwABBOgDAAAE6AMAAFBLAQIeAwoAAgAAAFGm5FogLfC+" +
    "BgAAAAYAAAAHABgAAAAAAAEAAACkgS4BAABjL2MudHh0VVQFAANqFGhodXgLAAEE6AMAAAToAwAA" +
    "UEsBAh4DCgACAAAA5abkWq7FQxUfAAAAHwAAAAwAGAAAAAAAAQAAAKSBdQEAAGMvaW5kZXguaHRt" +
    "bFVUBQADfRVoaHV4CwABBOgDAAAE6AMAAFBLBQYAAAAABgAGAM8BAADaAQAAAAA=",
  "base64",
);

describe("staticZipRoute", () => {
  const app = express();
  app.use(staticZipRoute(TEST_ZIP_BUFFER));

  it("fetches text files", async () => {
    const a = await request(app)
      .get("/a.txt")
      .expect(200)
      .expect("content-type", /^text\/plain/);
    expect(a.status).toBe(200);
    expect(a.text).toBe("file A");

    const b = await request(app)
      .get("/b/b.txt")
      .expect(200)
      .expect("content-type", /^text\/plain/);
    expect(b.status).toBe(200);
    expect(b.text).toBe("file B");

    const c = await request(app)
      .get("/c/c.txt")
      .expect(200)
      .expect("content-type", /^text\/plain/);
    expect(c.text).toBe("file C");
  });

  it("fetches index files by index.html and root", async () => {
    const indexHtml = await request(app)
      .get("/index.html")
      .expect(200)
      .expect("content-type", /^text\/html/);
    expect(indexHtml.text).toContain("<h1>Root Dir</h1>");
    const rootHtml = await request(app)
      .get("/")
      .expect(200)
      .expect("content-type", /^text\/html/);
    expect(rootHtml.text).toBe(indexHtml.text);
  });

  it("fetches index files by index.html in sub directories too", async () => {
    const indexHtml = await request(app)
      .get("/c/index.html")
      .expect(200)
      .expect("content-type", /^text\/html/);
    expect(indexHtml.text).toContain("<h1>Dir C</h1>");
    const rootHtml = await request(app)
      .get("/c")
      .expect(200)
      .expect("content-type", /^text\/html/);
    expect(rootHtml.text).toBe(indexHtml.text);
    const rootSlashHtml = await request(app)
      .get("/c/")
      .expect(200)
      .expect("content-type", /^text\/html/);
    expect(rootSlashHtml.text).toBe(rootHtml.text);
  });

  it("fetches does not hallucinate an index file where there is none", async () => {
    await request(app).get("/b").expect(404);
  });
});
