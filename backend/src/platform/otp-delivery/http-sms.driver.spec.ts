import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "../config";
import { HttpSmsDriver } from "./http-sms.driver";
import { DeliveryUnavailableError } from "./otp-delivery.port";

const CODE_MESSAGE = "Resilient-Learn code: 042317 — use this to set your password.";

function makeDriver(): HttpSmsDriver {
  const configService = {
    config: { SMS_HTTP_URL: "https://sms.example/send", SMS_HTTP_API_KEY: "a-key" },
  } as unknown as ConfigService;
  const driver = new HttpSmsDriver(configService);
  // Silence the Nest logger so a failing assertion isn't buried in output.
  Object.defineProperty(driver, "logger", {
    value: { error: () => {}, warn: () => {}, log: () => {} },
  });
  return driver;
}

describe("HttpSmsDriver", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("posts the message to the configured gateway with a bearer key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await makeDriver().send("+639171234567", CODE_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sms.example/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer a-key");
    expect(JSON.parse(init.body as string)).toEqual({
      to: "+639171234567",
      message: CODE_MESSAGE,
    });
  });

  it("throws DeliveryUnavailableError when the gateway answers non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(makeDriver().send("+639171234567", CODE_MESSAGE)).rejects.toBeInstanceOf(
      DeliveryUnavailableError,
    );
  });

  it("throws DeliveryUnavailableError when the request never lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(makeDriver().send("+639171234567", CODE_MESSAGE)).rejects.toBeInstanceOf(
      DeliveryUnavailableError,
    );
  });
});
