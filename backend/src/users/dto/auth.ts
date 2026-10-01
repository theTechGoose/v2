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

/** REQ-050: POST /auth/send-email-otp { email, language? } */
class SendEmailOtpDto {
  @IsString()
  email!: string;

  @IsOptional()
  @IsIn(["en", "es"])
  language?: Language;
}

/** REQ-050: POST /auth/verify-email-otp { email, code } */
class VerifyEmailOtpDto {
  @IsString()
  email!: string;

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

export function parseSendEmailOtp(input: unknown): SendEmailOtpDto {
  const dto = plainToInstance(SendEmailOtpDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid send-email-otp: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseVerifyEmailOtp(input: unknown): VerifyEmailOtpDto {
  const dto = plainToInstance(VerifyEmailOtpDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid verify-email-otp: ${JSON.stringify(errors)}`);
  return dto;
}
