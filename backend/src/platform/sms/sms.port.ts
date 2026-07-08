/**
 * SmsPort — outbound SMS behind a port (same pattern as ObjectStorage): the
 * activation flow depends on the interface only; drivers are swapped by
 * config (SMS_DRIVER=mock|http), keeping infrastructure portable per Annex A.
 */
export const SMS_PORT = Symbol("SMS_PORT");

export interface SmsPort {
  /** Sends `message` to `phone` (E.164). Drivers decide failure semantics. */
  send(phone: string, message: string): Promise<void>;
}
