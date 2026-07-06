import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import type { ZodType, output } from "zod";

/**
 * Hand-rolled Zod v4 integration (chosen over nestjs-zod to avoid fighting
 * its Zod-version coupling; ~40 lines, zero dependencies).
 *
 * Usage: `class LoginDto extends createZodDto(LoginRequestSchema) {}` then
 * `@Body() body: LoginDto`. The global ZodValidationPipe finds the static
 * schema on the metatype and parses (input is REPLACED by the parsed output,
 * so transforms/defaults apply).
 */

const ZOD_SCHEMA = Symbol.for("rl.zodSchema");

interface ZodDtoClass<T extends ZodType> {
  new (): output<T>;
  [ZOD_SCHEMA]: T;
}

export function createZodDto<T extends ZodType>(schema: T): ZodDtoClass<T> {
  class ZodDto {
    static readonly [ZOD_SCHEMA] = schema;
  }
  return ZodDto as unknown as ZodDtoClass<T>;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = (metadata.metatype as Partial<ZodDtoClass<ZodType>> | undefined)?.[
      ZOD_SCHEMA
    ];
    if (!schema) return value;
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
