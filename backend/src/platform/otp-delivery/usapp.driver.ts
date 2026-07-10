import { Injectable, Logger } from "@nestjs/common";
import { maskPhone } from "@rl/schemas";
import { ConfigService } from "../config";
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  RecipientNotRegisteredError,
  type OtpDeliveryPort,
} from "./otp-delivery.port";

/**
 * Usapp tenant-API driver. `POST /api/v1/messages/send` resolves recipientPhone
 * to a registered Usapp account and delivers an in-app message; a 404 means the
 * number has no Usapp account, which is exactly the activation prerequisite.
 *
 * Two rules this driver must keep:
 *   · never log `message` — it carries the live OTP code;
 *   · never retry — the call is user-triggered and rate-limited on both sides,
 *     so retrying a 429 deepens the hole and retrying a timeout can deliver two
 *     codes when the first request actually landed.
 */
@Injectable()
export class UsappDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("UsappOtpDelivery");

  constructor(private readonly configService: ConfigService) {}

  async send(phone: string, message: string): Promise<void> {
    const { USAPP_BASE_URL, USAPP_API_KEY, USAPP_TIMEOUT_MS } = this.configService.config;
    const base = USAPP_BASE_URL!.replace(/\/+$/, "");

    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/messages/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": USAPP_API_KEY!,
        },
        body: JSON.stringify({ recipientPhone: phone, content: message, format: "plain" }),
        signal: AbortSignal.timeout(USAPP_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `Usapp unreachable for ${maskPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new DeliveryUnavailableError();
    }

    if (response.ok) return;

    // Expected and actionable by the person activating — the auth module turns
    // this into copy. Not an operational fault, so it is not logged as one.
    if (response.status === 404) {
      throw new RecipientNotRegisteredError();
    }

    if (response.status === 429) {
      this.logger.warn(`Usapp rate-limited this tenant sending to ${maskPhone(phone)}`);
      throw new DeliveryRateLimitedError();
    }

    if (response.status === 401 || response.status === 403) {
      // Silent-until-someone-complains class of failure: name every cause, because
      // a generic "delivery failed" line buries the one thing an operator can fix.
      this.logger.error(
        `Usapp rejected this tenant (${response.status}) sending to ${maskPhone(phone)}. ` +
          `Check USAPP_API_KEY, that the key is neither revoked nor expired, that the ` +
          `tenant is active, and that this host's egress IP is in the tenant ipAllowlist.`,
      );
      throw new DeliveryUnavailableError();
    }

    this.logger.error(`Usapp answered ${response.status} sending to ${maskPhone(phone)}`);
    throw new DeliveryUnavailableError();
  }
}
