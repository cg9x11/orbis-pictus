const QUOTA_ERROR_PATTERN = /quota|rate.?limit|too many requests|exceeded|insufficient|overdue|throttl/i;

/**
 * "Ark doesn't recognise / can't serve this model id" — matched on the error code and message, and
 * deliberately NOT on the HTTP status.
 *
 * 404 alone is not sufficient: Ark also answers 404 with `TaskNotFound` when a *video task* id is
 * polled after expiry (see providers/video/ark.ts's checkTask and its test), which has nothing to
 * do with the model. Treating every 404 as an unknown model would silently reroute that into a
 * model fallback. Both alternatives below therefore require the word "model" to be present.
 *
 * Verified empirically against the live BytePlus Ark image API, 2026-08-08 — an unknown model id
 * returns status 404 with:
 *
 *   { error: { code: "InvalidEndpointOrModel.NotFound",
 *              message: "The model or endpoint <id> does not exist or you do not have access to it",
 *              type: "Not Found" } }
 *
 * A second real shape, `{ code: "ModelNotOpen", message: "…has not activated the model…" }` at 404,
 * is captured in providers/video/ark.test.ts. Both are matched below; the remaining wordings are
 * defensive and have NOT been observed live.
 */
const UNKNOWN_MODEL_PATTERN =
  /model.*(not.?(found|exist|open|activat|support)|invalid|unavailable|unsupported)|(invalid|unknown|unsupported|missing).*model/i;

interface ArkErrorBody {
  error?: { code?: string; message?: string; type?: string };
}

/** Shared between the image and video Ark providers — same API, same `{error:{code,message}}` shape. */
export class ArkRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get isQuotaOrRateError(): boolean {
    if (this.status === 429) return true;
    return QUOTA_ERROR_PATTERN.test(`${this.code ?? ""} ${this.message}`);
  }

  /** Whether this rejection is about the model id itself rather than the account's budget — see
   *  UNKNOWN_MODEL_PATTERN above for why the HTTP status is deliberately not consulted. */
  get isUnknownModelError(): boolean {
    return UNKNOWN_MODEL_PATTERN.test(`${this.code ?? ""} ${this.message}`);
  }
}

/** Builds an ArkRequestError from a failed fetch Response, parsing Ark's `{error:{code,message}}`
 *  body when present and falling back to the raw response text otherwise. `label` prefixes the
 *  fallback message (e.g. "Ark request failed", "Ark video request failed"). */
export async function toArkRequestError(res: Response, label: string): Promise<ArkRequestError> {
  const text = await res.text();
  let parsed: ArkErrorBody | null = null;
  try {
    parsed = JSON.parse(text) as ArkErrorBody;
  } catch {
    // non-JSON error body, fall through with raw text
  }
  return new ArkRequestError(res.status, parsed?.error?.code, parsed?.error?.message ?? `${label} (${res.status}): ${text}`);
}
