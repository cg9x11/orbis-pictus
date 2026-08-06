const QUOTA_ERROR_PATTERN = /quota|rate.?limit|too many requests|exceeded|insufficient|overdue|throttl/i;

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
