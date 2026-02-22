export type RagErrorInit = {
  code: string;
  message: string;
  status?: number;
  details?: Record<string, unknown>;
};

export class RagError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor({ code, message, status = 500, details }: RagErrorInit) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isRagError(error: unknown): error is RagError {
  return Boolean(error && typeof error === "object" && "code" in error);
}
