import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { maskPhone } from "@rl/schemas";
import { ConfigService } from "../config";
import type { SmsPort } from "./sms.port";

/**
 * Generic HTTP SMS gateway driver: POST {to, message} as JSON with a bearer
 * key. Config (SMS_HTTP_URL / SMS_HTTP_API_KEY) is validated required at boot
 * when SMS_DRIVER=http. 5s timeout — an SMS gateway must never hold a request
 * hostage.
 */
@Injectable()
export class HttpSmsDriver implements SmsPort {
  private readonly logger = new Logger("HttpSms");

  constructor(private readonly configService: ConfigService) {}

  async send(phone: string, message: string): Promise<void> {
    const { SMS_HTTP_URL, SMS_HTTP_API_KEY } = this.configService.config;
    try {
      const response = await fetch(SMS_HTTP_URL!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SMS_HTTP_API_KEY}`,
        },
        body: JSON.stringify({ to: phone, message }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error(`gateway responded ${response.status}`);
      }
    } catch (err) {
      // Log with a masked number — full phone numbers stay out of logs.
      this.logger.error(
        `SMS to ${maskPhone(phone)} did not go through: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException(
        "We couldn't send the SMS right now — try again in a few minutes.",
      );
    }
  }
}
