import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "../config";
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  RecipientNotRegisteredError,
} from "./otp-delivery.port";
import { UsappDriver } from "./usapp.driver";

const PHONE = "+639171234567";
const CODE = "042317";
const CODE_MESSAGE = `Resilient-Learn code: ${CODE} — use this to set your password. Valid 10 minutes.`;

/** Captures everything the driver logs so we can assert the code never appears. */
function makeDriver(
  baseUrl = "https://usapp.example.ph",
  timeoutMs = 5000,
): {
  driver: UsappDriver;
  logged: string[];
} {
  const configService = {
    config: {
      USAPP_BASE_URL: baseUrl,
      USAPP_API_KEY: "a-raw-key",
      USAPP_TIMEOUT_MS: timeoutMs,
    },
  } as unknown as ConfigService;

  const driver = new UsappDriver(configService);
  const logged: string[] = [];
  Object.defineProperty(driver, "logger", {
    value: {
      error: (m: string) => logged.push(m),
      warn: (m: string) => logged.push(m),
      log: (m: string) => logged.push(m),
    },
  });
  return { driver, logged };
}

function stubFetch(status: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("UsappDriver", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("posts the message to the tenant API with the X-API-Key header", async () => {
    const fetchMock = stubFetch(201);
    const { driver } = makeDriver();

    await driver.send(PHONE, CODE_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://usapp.example.ph/api/v1/messages/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("a-raw-key");
    expect(JSON.parse(init.body as string)).toEqual({
      recipientPhone: PHONE,
      content: CODE_MESSAGE,
      format: "plain",
    });
  });

  it("tolerates a trailing slash on USAPP_BASE_URL", async () => {
    const fetchMock = stubFetch(201);
    const { driver } = makeDriver("https://usapp.example.ph//");

    await driver.send(PHONE, CODE_MESSAGE);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://usapp.example.ph/api/v1/messages/send");
  });

  it("maps 404 to RecipientNotRegisteredError", async () => {
    stubFetch(404);
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(
      RecipientNotRegisteredError,
    );
  });

  it("maps 429 to DeliveryRateLimitedError", async () => {
    stubFetch(429);
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryRateLimitedError);
  });

  it.each([401, 403])("maps %i to DeliveryUnavailableError and names the likely causes", async (status) => {
    stubFetch(status);
    const { driver, logged } = makeDriver();

    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
    expect(logged.join("\n")).toMatch(/ipAllowlist/);
    expect(logged.join("\n")).toMatch(/USAPP_API_KEY/);
  });

  it.each([400, 500, 502])("maps %i to DeliveryUnavailableError", async (status) => {
    stubFetch(status);
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it("maps a transport failure to DeliveryUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it("maps a timeout to DeliveryUnavailableError", async () => {
    const abort = new Error("The operation was aborted due to timeout");
    abort.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it("never logs the OTP code, and masks the phone number", async () => {
    for (const status of [401, 500]) {
      stubFetch(status);
      const { driver, logged } = makeDriver();
      await driver.send(PHONE, CODE_MESSAGE).catch(() => {});

      const all = logged.join("\n");
      expect(all).not.toContain(CODE);
      expect(all).not.toContain(PHONE);
      vi.unstubAllGlobals();
    }
  });

  it("does not retry", async () => {
    const fetchMock = stubFetch(500);
    const { driver } = makeDriver();
    await driver.send(PHONE, CODE_MESSAGE).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes an AbortSignal to fetch", async () => {
    const fetchMock = stubFetch(201);
    const { driver } = makeDriver();

    await driver.send(PHONE, CODE_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("threads the timeout value from config to AbortSignal.timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = stubFetch(201);
    const { driver } = makeDriver("https://usapp.example.ph", 1234);

    await driver.send(PHONE, CODE_MESSAGE);

    expect(timeoutSpy).toHaveBeenCalledWith(1234);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
