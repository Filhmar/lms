import { createHash, createPublicKey } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "../../platform/config";

export interface RsaJwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
  alg: "RS256";
  use: "sig";
}

/** Builds the JWKS document from the configured RS256 public key. */
@Injectable()
export class JwksService {
  /** kid = base64url(SHA-256(SPKI DER)) — stable fingerprint of the key. */
  readonly kid: string;
  private readonly jwk: RsaJwk;

  constructor(configService: ConfigService) {
    const publicKey = createPublicKey(configService.config.jwtPublicKeyPem);
    const der = publicKey.export({ type: "spki", format: "der" });
    this.kid = createHash("sha256").update(der).digest("base64url");

    const { kty, n, e } = publicKey.export({ format: "jwk" }) as {
      kty: string;
      n: string;
      e: string;
    };
    this.jwk = { kty, n, e, kid: this.kid, alg: "RS256", use: "sig" };
  }

  getJwks(): { keys: RsaJwk[] } {
    return { keys: [this.jwk] };
  }
}
