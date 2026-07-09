import { Injectable, Logger } from "@nestjs/common";
import type { OtpDeliveryPort } from "./otp-delivery.port";

/**
 * Dev/demo driver: logs the message instead of sending it. Never throws —
 * a missing delivery must not block local flows (the code is also surfaced as
 * `devCode` when NODE_ENV=development). Logging the code here is the point;
 * every other driver must keep it out of the log.
 */
@Injectable()
export class MockDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("MockOtpDelivery");

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`OTP → ${phone}: ${message}`);
  }
}
