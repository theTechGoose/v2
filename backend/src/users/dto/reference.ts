import { IsInt, IsOptional, IsString, Min, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export interface Reference {
  id: string;
  userId: string;
  contactName: string;
  phoneNumber?: string;
  email?: string;
  jobDescription?: string;
  /** Display ordering — lower values render first. */
  position?: number;
  createdAt: string;
  updatedAt: string;
}

export class CreateReferenceDto {
  @IsString() contactName!: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() jobDescription?: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class UpdateReferenceDto {
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() phoneNumber?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() jobDescription?: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export function parseCreateReference(input: unknown): CreateReferenceDto {
  const dto = plainToInstance(CreateReferenceDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid reference: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateReference(input: unknown): UpdateReferenceDto {
  const dto = plainToInstance(UpdateReferenceDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid reference patch: ${JSON.stringify(errors)}`);
  return dto;
}
