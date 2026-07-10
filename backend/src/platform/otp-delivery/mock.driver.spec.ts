import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockDriver } from "./mock.driver";

const CODE_MESSAGE = "Resilient-Learn code: 042317 — use this to set your password.";
const PHONE = "+639171234567";
const MASKED_PHONE = "+63••••••4567";

function makeDriver(): { driver: MockDriver; logSpy: ReturnType<typeof vi.fn> } {
  const driver = new MockDriver();
  const logSpy = vi.fn();
  // Silence the Nest logger so a failing assertion isn't buried in output.
  Object.defineProperty(driver, "logger", {
    value: { error: () => {}, warn: () => {}, log: logSpy },
  });
  return { driver, logSpy };
}

describe("MockDriver", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("logs the OTP code with a masked phone number", async () => {
    const { driver, logSpy } = makeDriver();

    await driver.send(PHONE, CODE_MESSAGE);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = (logSpy.mock.calls[0]?.[0] ?? "") as string;

    // The masked phone must be in the log
    expect(loggedMessage).toContain(MASKED_PHONE);
    // The full phone number must NOT be in the log
    expect(loggedMessage).not.toContain(PHONE);
    // The OTP code must be in the log (the driver's purpose is to show the code)
    expect(loggedMessage).toContain(CODE_MESSAGE);
  });
});
