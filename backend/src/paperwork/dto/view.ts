import { IsIn, IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type PaperworkType = "quote" | "contract" | "invoice";
export const PAPERWORK_TYPES: PaperworkType[] = ["quote", "contract", "invoice"];

export class CreateViewDto {
  @IsIn(PAPERWORK_TYPES)
  paperworkType!: PaperworkType;

  @IsString()
  paperworkId!: string;

  @IsString()
  viewedAt!: string;

  @IsOptional() @IsString() viewerId?: string;
  @IsOptional() @IsString() viewerEmail?: string;
  @IsOptional() @IsString() userAgent?: string;
  @IsOptional() @IsString() ipAddress?: string;
  @IsOptional() @IsString() referrer?: string;
  @IsOptional() @IsNumber() durationMs?: number;
}

export class UpdateViewDto {
  @IsOptional() @IsIn(PAPERWORK_TYPES) paperworkType?: PaperworkType;
  @IsOptional() @IsString() paperworkId?: string;
  @IsOptional() @IsString() viewedAt?: string;
  @IsOptional() @IsString() viewerId?: string;
  @IsOptional() @IsString() viewerEmail?: string;
  @IsOptional() @IsString() userAgent?: string;
  @IsOptional() @IsString() ipAddress?: string;
  @IsOptional() @IsString() referrer?: string;
  @IsOptional() @IsNumber() durationMs?: number;
}

export interface View extends CreateViewDto {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreateView(input: unknown): CreateViewDto {
  const dto = plainToInstance(CreateViewDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid view: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateView(input: unknown): UpdateViewDto {
  const dto = plainToInstance(UpdateViewDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid view patch: ${JSON.stringify(errors)}`);
  return dto;
}
