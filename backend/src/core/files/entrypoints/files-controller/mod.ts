import { Body, Context, Controller, Delete, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";

class CreateFileDto {
  @IsString() filename!: string;
  @IsString() mimeType!: string;
  /** Base64-encoded bytes. Frontend converts before POSTing. */
  @IsString() base64!: string;
}

function parseCreate(input: unknown): CreateFileDto {
  const dto = plainToInstance(CreateFileDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid file: ${JSON.stringify(errors)}`);
  return dto;
}

@Controller("files")
export class FilesController {
  constructor(
    private store: FileStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /**
   * POST /files
   *   body: { filename, mimeType, base64 }
   *
   * JSON-friendly upload (no multipart parser dependency). Frontend uses
   * `FileReader.readAsDataURL(file).then(strip-prefix).then(POST)`.
   */
  @Post()
  async upload(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseCreate(body);
    const bytes = decodeBase64(dto.base64);
    const meta = await this.store.create({
      userId: user.id,
      filename: dto.filename,
      mimeType: dto.mimeType,
      bytes,
    });
    return ctx.json(meta);
  }

  @Get()
  async list(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.store.listByUser(user.id));
  }

  /** GET /files/:id/meta — JSON metadata only (size, mime, sha256, etc). */
  @Get(":id/meta")
  async meta(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.store.getOwnedMeta(id, user.id));
  }

  /** GET /files/:id — binary download with the original mime type. */
  @Get(":id")
  async download(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const meta = await this.store.getOwnedMeta(id, user.id);
    const bytes = await this.store.readBytes(id);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type":         meta.mimeType,
        "content-length":       String(bytes.length),
        "content-disposition":  `inline; filename="${encodeFilename(meta.filename)}"`,
      },
    });
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return ctx.json({ ok: true });
  }
}

function decodeBase64(b64: string): Uint8Array {
  // Strip data-uri prefix if present (FileReader.readAsDataURL adds one).
  const stripped = b64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9_.\-]/g, "_");
}
