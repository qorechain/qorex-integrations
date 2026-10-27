// SPDX-License-Identifier: Apache-2.0

/**
 * Stable error codes thrown by the qorex-integrations packages (not by QoreX
 * itself). New codes may be added; existing ones never change meaning.
 *
 * - `QOREX_NOT_INSTALLED`: no QoreX provider in this page.
 * - `QOREX_USE_SIGN_AND_BROADCAST`: a signer-based transaction was attempted on
 *   QoreChain; send the messages through `signAndBroadcast` instead.
 * - `QOREX_AMINO_REFUSED`: Amino JSON signing, refused by design.
 * - `QOREX_NOT_SUPPORTED_YET`: QoreX does not offer this yet.
 */
export type QorexIntegrationErrorCode =
  | "QOREX_NOT_INSTALLED"
  | "QOREX_USE_SIGN_AND_BROADCAST"
  | "QOREX_AMINO_REFUSED"
  | "QOREX_NOT_SUPPORTED_YET";

/** Error thrown on purpose by the qorex-integrations packages. Test `code`, not `message`. */
export class QorexIntegrationError extends Error {
  readonly code: QorexIntegrationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: QorexIntegrationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "QorexIntegrationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** True when `error` is a `QorexIntegrationError`, optionally with the given code. Works across package copies. */
export function isQorexIntegrationError(
  error: unknown,
  code?: QorexIntegrationErrorCode,
): error is QorexIntegrationError {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { name?: unknown; code?: unknown };
  if (e.name !== "QorexIntegrationError" || typeof e.code !== "string") return false;
  return code === undefined || e.code === code;
}

/** Message used for `QOREX_AMINO_REFUSED`. */
export const QOREX_AMINO_REFUSED_MESSAGE =
  "QOREX_AMINO_REFUSED: refused by design: Amino JSON cannot carry the hybrid ML-DSA-87 signature. Use SIGN_MODE_DIRECT, or signAndBroadcast on QoreChain.";

/** Message used for `QOREX_USE_SIGN_AND_BROADCAST`. */
export function useSignAndBroadcastMessage(chainId: string): string {
  return (
    `QOREX_USE_SIGN_AND_BROADCAST: on ${chainId} QoreX does not sign a transaction the page built, ` +
    "because only the wallet can add the hybrid ML-DSA-87 (FIPS 204) signature. " +
    "Send the messages with signAndBroadcast; QoreX builds, signs and broadcasts the transaction."
  );
}

/** Message used for `QOREX_NOT_SUPPORTED_YET`. */
export function notSupportedYetMessage(feature: string): string {
  return `QOREX_NOT_SUPPORTED_YET: ${feature} is not supported by QoreX yet; it is planned for a future QoreX version.`;
}

/** Message used for `QOREX_NOT_INSTALLED`. */
export const QOREX_NOT_INSTALLED_MESSAGE =
  "QOREX_NOT_INSTALLED: QoreX was not found in this page. Install the QoreX extension or open the page in the QoreX app.";

function errorParts(error: unknown): { code?: unknown; message: string } {
  if (typeof error !== "object" || error === null) return { message: "" };
  const e = error as { code?: unknown; message?: unknown };
  return { code: e.code, message: typeof e.message === "string" ? e.message : "" };
}

/**
 * True when QoreX's EVM provider refused a method it does not answer.
 * Checks the EIP-1193 code 4200 first (planned), then the message text QoreX
 * sends today: "QoreX: EVM method <name> not yet supported".
 */
export function isQorexUnsupportedMethodError(error: unknown): boolean {
  const { code, message } = errorParts(error);
  if (code === 4200) return true;
  return /^QoreX: EVM method \S+ not yet supported/.test(message);
}

/**
 * True when QoreX's EVM provider does not know the requested chain.
 * Checks the EIP-1193 code 4902 first, then the message text
 * "QoreX: unrecognized chain <id>".
 */
export function isQorexUnrecognizedChainError(error: unknown): boolean {
  const { code, message } = errorParts(error);
  if (code === 4902) return true;
  return /^QoreX: unrecognized chain /.test(message);
}
