import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export class CreateAccountDto {
  @IsString()
  name!: string;

  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() description?: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() description?: string;
}

export interface Account extends CreateAccountDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreateAccount(input: unknown): CreateAccountDto {
  const dto = plainToInstance(CreateAccountDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid account: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateAccount(input: unknown): UpdateAccountDto {
  const dto = plainToInstance(UpdateAccountDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid account patch: ${JSON.stringify(errors)}`);
  return dto;
}
