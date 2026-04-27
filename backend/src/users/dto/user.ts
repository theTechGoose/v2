import { IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type Language = "en" | "es";

export interface User {
  id: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  language?: Language;
  createdAt: string;
  updatedAt: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(["en", "es"])
  language?: Language;
}

export function parseUpdateUser(input: unknown): UpdateUserDto {
  const dto = plainToInstance(UpdateUserDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid user patch: ${JSON.stringify(errors)}`);
  return dto;
}
