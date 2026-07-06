import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../platform/prisma.service";
import type { RefreshToken, User } from "../../generated/prisma/client";

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
}
