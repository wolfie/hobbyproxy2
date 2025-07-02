import yauzl, { type Entry } from "yauzl";

export type ExtractedZip = Record<string, Buffer>;
const unzip = (zipFileBuffer: Buffer) =>
  new Promise<ExtractedZip>(async (resolve, reject) => {
    yauzl.fromBuffer(zipFileBuffer, (err, zipFile) => {
      if (err) {
        return reject(err);
      }

      const checkForEnd = () => {
        entriesProcessed++;
        if (zipFile.entryCount <= entriesProcessed) {
          resolve(extractedZip);
          zipFile.close();
        }
      };

      const extractedZip: ExtractedZip = {};
      let entriesProcessed = 0;
      zipFile.on("error", reject);
      zipFile.on("entry", (entry: Entry) => {
        if (entry.fileName.endsWith("/")) {
          // ignore directory entries, as we don't need them
          checkForEnd();
          return;
        }

        let buffers: Buffer[] = [];
        zipFile.openReadStream(entry, (err, readable) => {
          if (err) reject(err);
          readable.on("data", (data) => buffers.push(data));
          readable.on("end", () => {
            extractedZip[entry.fileName] = Buffer.concat(buffers);
            checkForEnd();
          });
        });
        return;
      });
    });
  });

export default unzip;
