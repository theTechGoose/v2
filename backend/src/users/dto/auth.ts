import { IsIn, IsOptional, IsString, MaxLength, MinLength, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { Language } from "@users/dto/user.ts";

export class SendOtpDto {
  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsIn(["en", "es"])
  language?: Language;
}

export class VerifyOtpDto {
  @IsString()
  phoneNumber!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export function parseSendOtp(input: unknown): SendOtpDto {
  const dto = plainToInstance(SendOtpDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid send-otp: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseVerifyOtp(input: unknown): VerifyOtpDto {
  const dto = plainToInstance(VerifyOtpDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid verify-otp: ${JSON.stringify(errors)}`);
  return dto;
}
