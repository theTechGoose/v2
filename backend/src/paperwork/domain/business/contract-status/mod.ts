import type { Contract } from "@paperwork/dto/contract.ts";

export function isSigned(contract: Pick<Contract, "signedAt" | "status">): boolean {
  if (contract.signedAt && contract.signedAt.length > 0) return true;
  return contract.status === "signed";
}
