import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { Readable } from "node:stream";
import { OBJECT_STORAGE } from "../../platform/storage/object-storage.port";
import type { ObjectStorage } from "../../platform/storage/object-storage.port";
import { CurrentUser, JwtAuthGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { CoursesService } from "./courses.service";

/** Phase III headless course delivery. All authenticated roles. */
@Controller("courses")
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(
    private readonly service: CoursesService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** GET /api/v1/courses — visible published courses (downward inheritance). */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listCourses(user);
  }

  /** GET /api/v1/courses/:id/manifest — chapters → pages, ordered by seq. */
  @Get(":id/manifest")
  manifest(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getManifest(id, user);
  }

  /** GET /api/v1/courses/:id/progress — the caller's completed pages. */
  @Get(":id/progress")
  progress(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getProgress(id, user);
  }

  /**
   * GET /api/v1/courses/:id/assets/:key — stream a course video from the
   * ObjectStorage port. Supports single-range requests (video scrubbing):
   * 206 + Content-Range for `bytes=a-b` / `bytes=a-` / `bytes=-n`; multi-
   * range falls back to the whole file; unsatisfiable ranges → 416.
   */
  @Get(":id/assets/:key")
  async asset(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("key") key: string,
    @Headers("range") rangeHeader: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.service.resolveAsset(id, key, user);

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", asset.contentType);

    const range = parseSingleRange(rangeHeader, asset.sizeBytes);
    if (range === "unsatisfiable") {
      res.status(416).setHeader("Content-Range", `bytes */${asset.sizeBytes}`);
      res.end();
      return;
    }

    let stream: Readable;
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${asset.sizeBytes}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      stream = await this.storage.getStream(asset.storageKey, range);
    } else {
      res.status(200);
      res.setHeader("Content-Length", String(asset.sizeBytes));
      stream = await this.storage.getStream(asset.storageKey);
    }

    stream.on("error", () => {
      // Headers may already be on the wire — abort the socket, never a 500 body.
      stream.destroy();
      res.destroy();
    });
    stream.pipe(res);
  }
}

/**
 * RFC 9110 single-range parser (inclusive byte offsets). Returns null for
 * "no/ignorable range" (serve the whole file), "unsatisfiable" for a
 * syntactically valid range that cannot be served.
 */
function parseSingleRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // malformed or multi-range → whole file
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // suffix form: last N bytes
    const suffix = Number(rawEnd);
    if (suffix === 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
