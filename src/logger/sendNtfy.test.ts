import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import sendNtfy from "./sendNtfy.ts";

const TEST_URL = new URL("https://test.server");
const TEST_MESSAGE = {
  topic: "test-topic",
  message: "This is a test message",
  title: "Test Notification",
  tags: ["test", "notification"],
  priority: 3,
  actions: [
    {
      action: "view",
      label: "View Details",
      url: new URL("https://example.com/details"),
    },
  ],
} as const;

describe("sendNtfy", () => {
  const originalFetch = global.fetch;
  let mockedFetch = vi.mocked(global.fetch);
  beforeEach(() => {
    global.fetch = mockedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("should send a message to ntfy", async () => {
    await sendNtfy(TEST_URL, TEST_MESSAGE);

    expect(mockedFetch).toHaveBeenCalledWith(TEST_URL, {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify(TEST_MESSAGE),
    });
  });

  describe("retries", () => {
    beforeAll(() => {
      vi.useFakeTimers();
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it("retries once after one failure", async () => {
      mockedFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await sendNtfy(TEST_URL, TEST_MESSAGE);
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      if (result.success) throw new Error("should've failed");
      if (result.cause !== "failed")
        throw new Error("Error cause should've been 'failed'");

      vi.advanceTimersToNextTimer();

      expect(mockedFetch).toHaveBeenCalledTimes(2);
      await expect(result.retryPromise).resolves.toBeUndefined();
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    it("retryPromise rejects after 10 retries (and 1 main try)", async () => {
      mockedFetch.mockRejectedValue(new Error("Network error"));

      const result = await sendNtfy(TEST_URL, TEST_MESSAGE);
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      if (result.success) throw new Error("should've failed");
      if (result.cause !== "failed")
        throw new Error("Error cause should've been 'failed'");

      await vi.waitFor(async () => {
        vi.advanceTimersToNextTimer();
        expect(mockedFetch).toHaveBeenCalledTimes(10); // 1 main try + 9 retries
      });

      await expect(() => {
        vi.advanceTimersToNextTimer();
        return result.retryPromise;
      }).rejects.toThrow();
    });

    it("adds new messages to queue if there is a failure queue ongoing", async () => {
      mockedFetch.mockRejectedValue(new Error("Network error"));

      await sendNtfy(TEST_URL, TEST_MESSAGE);
      const result = await sendNtfy(TEST_URL, TEST_MESSAGE);
      if (result.success) throw new Error("Should've failed");
      if (result.cause !== "retrying")
        throw new Error("Should've been retrying");
      expect(result.queueSize).toBe(2);
    });
  });
});
