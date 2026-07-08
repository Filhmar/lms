import type { Readable } from "node:stream";

/** Inclusive byte offsets (HTTP Range semantics). */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * ObjectStorage port (TECHSTACK: storage always goes through this port so
 * Annex A portability holds — S3 and Azure Blob drivers arrive later; Phase I
 * ships the local-fs driver only). `range` maps 1:1 onto S3 `Range:` /
 * Azure Blob offset+count, so the optional param keeps drivers portable.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  getStream(key: string, range?: ByteRange): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
