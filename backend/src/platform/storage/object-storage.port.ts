import type { Readable } from "node:stream";

/**
 * ObjectStorage port (TECHSTACK: storage always goes through this port so
 * Annex A portability holds — S3 and Azure Blob drivers arrive later; Phase I
 * ships the local-fs driver only).
 */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
