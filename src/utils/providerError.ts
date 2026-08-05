// Turns a raw model-provider failure into something safe to put in front of a
// user. Google's errors carry the request URL, the internal model id, and
// billing console links — none of which belong in a chat bubble, and the model
// id in particular is not something we publish.
//
// The raw error still reaches the server log; only what crosses the wire is
// rewritten.

export interface ProviderErrorDescription {
  code: string;
  message: string;
}

/**
 * Google reports the status either as a numeric field or, through the LangChain
 * wrapper, only as a bracketed code inside the message text
 * ("[GoogleGenerativeAI Error]: ... [429 Too Many Requests] ...").
 */
export function extractProviderHttpStatus(error: any): number | undefined {
  const direct = error?.status ?? error?.statusCode ?? error?.status_code;
  if (typeof direct === "number") {
    return direct;
  }

  const match = String(error?.message ?? "").match(/\[(\d{3})\b/);
  return match ? Number(match[1]) : undefined;
}

// Only phrases that name the key or the caller's identity. A generic "invalid"
// would match malformed-request errors and misreport a working key as rejected.
const AUTH_FAILURE_PATTERNS = [
  "api key not valid",
  "api_key_invalid",
  "invalid api key",
  "api key expired",
  "permission_denied",
  "permission denied",
  "unauthenticated",
  "unauthorized",
];

export function isProviderAuthFailure(error: unknown): boolean {
  const status = extractProviderHttpStatus(error);
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }
  if (status !== undefined) {
    return false;
  }

  const message = String((error as any)?.message ?? "").toLowerCase();
  return AUTH_FAILURE_PATTERNS.some((pattern) => message.includes(pattern));
}

// A spend cap or exhausted allowance is a 429 that will not clear on a retry,
// so it must not be described as "temporary" the way a rate limit is.
const BILLING_PATTERNS = ["spending cap", "spend cap", "billing", "exceeded its monthly"];

function isBillingLimit(error: unknown): boolean {
  const message = String((error as any)?.message ?? "").toLowerCase();
  return BILLING_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * `source` decides who is being told about whose problem: on a user's own key
 * the limit is theirs and there is something they can do, whereas on the
 * platform key it is our outage and advice to check billing would be nonsense.
 */
export function describeProviderError(
  error: unknown,
  source: "user" | "platform",
): ProviderErrorDescription {
  const status = extractProviderHttpStatus(error);

  if (isProviderAuthFailure(error)) {
    return source === "user"
      ? {
          code: "PROVIDER_KEY_REJECTED",
          message:
            "Your saved API key was rejected. Update it in Settings, or remove it to fall back to the free allowance.",
        }
      : {
          code: "PROVIDER_UNAVAILABLE",
          message:
            "The AI service rejected this request. Please try again shortly.",
        };
  }

  if (status === 429) {
    if (isBillingLimit(error)) {
      return source === "user"
        ? {
            code: "PROVIDER_QUOTA_EXCEEDED",
            message:
              "Your Google AI project has hit its spending cap, so Gemini refused the request. Raise the cap in Google AI Studio, or remove your key in Settings to use the free allowance.",
          }
        : {
            code: "PROVIDER_QUOTA_EXCEEDED",
            message:
              "The AI service has reached its usage limit and cannot answer right now. Adding your own API key in Settings will keep you running.",
          };
    }

    return {
      code: "PROVIDER_RATE_LIMITED",
      message:
        "The AI service is busy right now. Please send the message again in a few seconds.",
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      code: "PROVIDER_UNAVAILABLE",
      message:
        "The AI service is temporarily unavailable. Please try again in a moment.",
    };
  }

  return {
    code: "GENERATION_FAILED",
    message:
      "Something went wrong while generating the answer. Please try again.",
  };
}
