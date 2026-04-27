import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export interface BusinessAddress {
  userId: string;
  street?: string;
  city?: string;
  state?: string;       // 2-letter US code
  postal?: string;
  country?: string;     // default "US"
  createdAt: string;
  updatedAt: string;
}

export class UpdateBusinessAddressDto {
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postal?: string;
  @IsOptional() @IsString() country?: string;
}

export function parseUpdateBusinessAddress(input: unknown): UpdateBusinessAddressDto {
  const dto = plainToInstance(UpdateBusinessAddressDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid business address: ${JSON.stringify(errors)}`);
  return dto;
}
