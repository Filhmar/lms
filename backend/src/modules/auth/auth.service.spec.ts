import {
  BadGatewayException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  RecipientNotRegisteredError,
} from "../../platform/otp-delivery/otp-delivery.port";
import { AuthService } from "./auth.service";

const PENDING_USER = {
  id: "user-1",
  email: "ana.reyes@deped.gov.ph",
  fullName: "Ana Reyes",
  role: "student",
  scopeId: "scope-1",
  status: "pending_activation",
  phone: "+639171234567",
};

function makeService(send: (phone: string, message: string) => Promise<void>) {
  const repo = {
    findUserByEmail: vi.fn().mockResolvedValue(PENDING_USER),
    replaceActivationOtp: vi.fn().mockResolvedValue(undefined),
  };
  const redis = {
    client: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
  };
  const configService = {
    config: { NODE_ENV: "test", OTP_DELIVERY_DRIVER: "usapp" },
  };
  const delivery = { send: vi.fn(send) };

  const service = new AuthService(
    repo as never,
    {} as never, // JwtService — unused by requestActivation
    {} as never, // JwksService — unused by requestActivation
    configService as never,
    redis as never,
    delivery as never,
  );

  return { service, repo, delivery };
}

describe("AuthService.requestActivation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delivers the code, then persists it, and reports the channel", async () => {
    const { service, repo, delivery } = makeService(async () => {});

    const res = await service.requestActivation(PENDING_USER.email, "203.0.113.7");

    expect(delivery.send).toHaveBeenCalledTimes(1);
    expect(repo.replaceActivationOtp).toHaveBeenCalledTimes(1);
    expect(res.channel).toBe("usapp");
    expect(res.maskedPhone).toBe("+63••••••4567");
    expect(res.devCode).toBeUndefined();
  });

  it("sends the six-digit code inside the message it delivers", async () => {
    const { service, delivery } = makeService(async () => {});

    await service.requestActivation(PENDING_USER.email, "203.0.113.7");

    const [phone, message] = delivery.send.mock.calls[0] as [string, string];
    expect(phone).toBe(PENDING_USER.phone);
    expect(message).toMatch(/Resilient-Learn code: \d{6}/);
  });

  it("answers 409 and burns no code when the number is not on Usapp", async () => {
    const { service, repo } = makeService(async () => {
      throw new RecipientNotRegisteredError();
    });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toBeInstanceOf(
      ConflictException,
    );

    // The invariant this whole change exists to protect: a failed delivery must
    // never invalidate a code the student is still holding.
    expect(repo.replaceActivationOtp).not.toHaveBeenCalled();
  });

  it("answers 503 and burns no code when the delivery network throttles us", async () => {
    const { service, repo } = makeService(async () => {
      throw new DeliveryRateLimitedError();
    });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(repo.replaceActivationOtp).not.toHaveBeenCalled();
  });

  it("answers 502 and burns no code when the delivery network is down", async () => {
    const { service, repo } = makeService(async () => {
      throw new DeliveryUnavailableError();
    });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(repo.replaceActivationOtp).not.toHaveBeenCalled();
  });

  it("never delivers to an account that is not pending activation", async () => {
    const { service, delivery, repo } = makeService(async () => {});
    repo.findUserByEmail.mockResolvedValue({ ...PENDING_USER, status: "active" });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toThrow(
      /can't activate this account/,
    );
    expect(delivery.send).not.toHaveBeenCalled();
  });
});
