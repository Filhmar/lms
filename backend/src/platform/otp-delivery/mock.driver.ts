import { Injectable, Logger } from "@nestjs/common";
import { maskPhone } from "@rl/schemas";
import type { OtpDeliveryPort } from "./otp-delivery.port";

/**
 * Dev/demo driver: logs the message instead of sending it. Never throws —
 * a missing delivery must not block local flows (the code is also surfaced as
 * `devCode` when NODE_ENV=development). Logs the recipient as a masked number
 * and the message in full (printing the code is the point).
 */
@Injectable()
export class MockDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("MockOtpDelivery");

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`OTP → ${maskPhone(phone)}: ${message}`);
  }
}
