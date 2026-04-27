import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export interface BusinessIdentity {
  userId: string;
  businessName?: string;
  legalName?: string;
  businessLicense?: string;
  logoFileId?: string;
  createdAt: string;
  updatedAt: string;
}

export class UpdateBusinessIdentityDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  businessLicense?: string;

  @IsOptional()
  @IsString()
  logoFileId?: string;
}

export function parseUpdateBusinessIdentity(input: unknown): UpdateBusinessIdentityDto {
  const dto = plainToInstance(UpdateBusinessIdentityDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid business identity: ${JSON.stringify(errors)}`);
  return dto;
}
