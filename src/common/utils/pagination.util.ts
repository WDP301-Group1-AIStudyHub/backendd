export interface PaginationInput {
  page?: string | number;
  limit?: string | number;
}

export interface PaginationOptions {
  defaultPage?: number;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationResponse {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

const toPositiveInteger = (
  value: string | number | undefined,
  fallback: number,
): number => {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(value || "", 10);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
};

export const paginate = (
  input: PaginationInput = {},
  options: PaginationOptions = {},
): PaginationResult => {
  const defaultPage = options.defaultPage || 1;
  const defaultLimit = options.defaultLimit || 10;
  const maxLimit = options.maxLimit || 50;
  const page = toPositiveInteger(input.page, defaultPage);
  const parsedLimit = toPositiveInteger(input.limit, defaultLimit);
  const limit = Math.min(parsedLimit, maxLimit);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

export const buildPaginationResponse = (
  page: number,
  limit: number,
  totalItems: number,
): PaginationResponse => ({
  page,
  limit,
  totalItems,
  totalPages: Math.ceil(totalItems / limit),
});
