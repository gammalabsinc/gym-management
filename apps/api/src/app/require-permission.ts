import { type ForbiddenError, forbidden } from "../domain/errors";
import { hasPermission, type Permission, type Role } from "../domain/permissions";
import type { Result } from "../domain/result";

/** What the guard needs to know about the caller. The roles come from the session, never from input. */
export interface PermissionContext {
  readonly roles: readonly Role[];
}

export type UseCase<I, C, T, E> = (input: I, ctx: C) => Promise<Result<T, E>>;

/** A use case that has been wrapped by requirePermission. It says which permission it needs. */
export interface GuardedUseCase<I, C, T, E> {
  (input: I, ctx: C): Promise<Result<T, E | ForbiddenError>>;
  readonly requiredPermission: Permission;
}

/**
 * Wraps a use case so it only runs for a caller whose roles hold the permission. The check
 * happens before the use case is called, so a denied caller never reaches it.
 */
export function requirePermission<I, C extends PermissionContext, T, E>(
  permission: Permission,
  useCase: UseCase<I, C, T, E>,
): GuardedUseCase<I, C, T, E> {
  const guarded = async (input: I, ctx: C): Promise<Result<T, E | ForbiddenError>> =>
    hasPermission(ctx.roles, permission) ? useCase(input, ctx) : forbidden();
  return Object.assign(guarded, { requiredPermission: permission });
}

export function isGuarded<I, C, T, E>(
  useCase: UseCase<I, C, T, E> | GuardedUseCase<I, C, T, E>,
): useCase is GuardedUseCase<I, C, T, E> {
  return "requiredPermission" in useCase;
}

/**
 * Default deny. A use case that was not wrapped by requirePermission is replaced by one that
 * refuses every caller, so forgetting the guard fails closed instead of open.
 */
export function denyUnguarded<I, C, T, E>(
  useCase: UseCase<I, C, T, E> | GuardedUseCase<I, C, T, E>,
): UseCase<I, C, T, E | ForbiddenError> {
  return isGuarded(useCase) ? useCase : async () => forbidden();
}
