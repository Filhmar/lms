import { createReadStream } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config";
import type { ObjectStorage } from "./object-storage.port";

/** Local filesystem ObjectStorage driver (dev / single-node deployments). */
@Injectable()
export class LocalFsStorage implements ObjectStorage {
  private readonly root: string;

  constructor(configService: ConfigService) {
    this.root = configService.config.storageDir;
  }

  private resolveKey(key: string): string {
    const full = normalize(join(this.root, key));
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }
}
