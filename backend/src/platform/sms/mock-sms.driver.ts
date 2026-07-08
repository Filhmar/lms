import { Injectable, Logger } from "@nestjs/common";
import type { SmsPort } from "./sms.port";

/**
 * Dev/demo driver: logs the message instead of sending it. Never throws —
 * a missing SMS must not block local flows (the code is also surfaced as
 * `devCode` when NODE_ENV=development).
 */
@Injectable()
export class MockSmsDriver implements SmsPort {
  private readonly logger = new Logger("MockSms");

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`SMS → ${phone}: ${message}`);
  }
}
