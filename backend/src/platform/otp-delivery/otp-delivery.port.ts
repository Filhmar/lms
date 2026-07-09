/**
 * OtpDeliveryPort — outbound one-time-code delivery behind a port (same pattern
 * as ObjectStorage): the activation flow depends on the interface only; drivers
 * are swapped by config (OTP_DELIVERY_DRIVER=mock|http|usapp), keeping
 * infrastructure portable per Annex A.
 *
 * Drivers signal failure with the domain errors below and never throw HTTP
 * exceptions: mapping to a status code and to student-facing copy belongs to the
 * auth module, not to infrastructure.
 */
export const OTP_DELIVERY_PORT = Symbol("OTP_DELIVERY_PORT");

/** The recipient holds no account on the delivery network (Usapp answers 404). */
export class RecipientNotRegisteredError extends Error {
  constructor(message = "Recipient is not registered on the delivery network") {
    super(message);
    this.name = "RecipientNotRegisteredError";
  }
}

/** The delivery network throttled us (Usapp answers 429). Retrying now deepens it. */
export class DeliveryRateLimitedError extends Error {
  constructor(message = "Delivery network rate limit exceeded") {
    super(message);
    this.name = "DeliveryRateLimitedError";
  }
}

/** Everything else: transport fault, timeout, 5xx, or a misconfigured tenant. */
export class DeliveryUnavailableError extends Error {
  constructor(message = "Delivery network is unavailable") {
    super(message);
    this.name = "DeliveryUnavailableError";
  }
}

export interface OtpDeliveryPort {
  /** Sends `message` to `phone` (E.164). Throws one of the errors above. */
  send(phone: string, message: string): Promise<void>;
}
