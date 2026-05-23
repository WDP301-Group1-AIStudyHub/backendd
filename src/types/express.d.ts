import { UserRole } from "./api.types";

declare global {
  namespace Express {
    interface AuthUserPayload {
      id: string;
      email: string;
      role: UserRole;
    }

    interface Request {
      authUser?: AuthUserPayload;
    }
  }
}

export {};
