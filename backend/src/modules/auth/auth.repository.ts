import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../platform/prisma.service";
import type { OtpRequest, RefreshToken, User } from "../../generated/prisma/client";

const ACTIVATION = "activation";

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { email } });
  }

  createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.client.refreshToken.create({ data: input });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.client.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revokeToken(id: string, replacedBy?: string): Promise<void> {
    await this.prisma.client.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), replacedBy: replacedBy ?? null },
    });
  }

  /** Reuse detection response: kill the user's entire active token family. */
  async revokeAllUserTokens(userId: string): Promise<number> {
    const result = await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  findUserById(id: string): Promise<User | null> {
    return this.prisma.client.user.findUnique({ where: { id } });
  }

  /* ------------------- Phone-OTP activation (auth.otp_requests) ------------------- */

  /**
   * Supersede every unconsumed code and issue a fresh one, atomically. Two
   * separate statements could crash between them and leave the account with no
   * valid code and no record of why.
   */
  async replaceActivationOtp(input: {
    userId: string;
    phone: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.client.$transaction([
      this.prisma.client.otpRequest.updateMany({
        where: { userId: input.userId, purpose: ACTIVATION, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.client.otpRequest.create({ data: { ...input, purpose: ACTIVATION } }),
    ]);
  }

  /** Latest unconsumed activation code (expiry/attempts judged by the caller). */
  findLatestActivationOtp(userId: string): Promise<OtpRequest | null> {
    return this.prisma.client.otpRequest.findFirst({
      where: { userId, purpose: ACTIVATION, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.prisma.client.otpRequest.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  async consumeOtp(id: string): Promise<void> {
    await this.prisma.client.otpRequest.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }

  /** Password set + status flip + OTP consumption — one atomic transaction. */
  async activateUser(userId: string, passwordHash: string, otpId: string): Promise<void> {
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: { passwordHash, status: "active" },
      }),
      this.prisma.client.otpRequest.update({
        where: { id: otpId },
        data: { consumedAt: new Date() },
      }),
    ]);
  }
}
