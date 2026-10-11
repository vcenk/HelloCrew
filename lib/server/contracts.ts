// Design contracts only. There are intentionally no in-memory substitutes for durable controls.
import type { BusinessProfile } from "../business";
export interface VerifiedPrincipal {
  userId: string;
  tenantId: string;
}
export interface TenantRepository {
  // The implementation must verify membership from trusted server identity, never request body IDs.
  getBusiness(
    principal: VerifiedPrincipal,
  ): Promise<{ version: number; profile: BusinessProfile }>;
  saveBusiness(
    principal: VerifiedPrincipal,
    expectedVersion: number,
    profile: BusinessProfile,
  ): Promise<number>;
}
export interface CheckpointRepository {
  load(
    principal: VerifiedPrincipal,
    conversationId: string,
  ): Promise<{ version: number; state: unknown } | null>;
  compareAndSwap(
    principal: VerifiedPrincipal,
    conversationId: string,
    expectedVersion: number,
    state: unknown,
  ): Promise<boolean>;
}
export interface UsageLedger {
  // Atomically reserve worst-case cost against tenant AND platform budgets and replay key.
  // Reservation holds remain charged after ambiguous provider outcomes until reconciled.
  reserve(
    principal: VerifiedPrincipal,
    requestId: string,
    worstCaseMicroUsd: bigint,
  ): Promise<{ reservationId: string } | null>;
  settle(
    principal: VerifiedPrincipal,
    reservationId: string,
    actualMicroUsd: bigint,
  ): Promise<void>;
}
export interface ApprovalRepository {
  // Atomically verify tenant, immutable action hash, expiry and pending status before consuming.
  consume(
    principal: VerifiedPrincipal,
    approvalId: string,
    actionHash: string,
  ): Promise<boolean>;
}
