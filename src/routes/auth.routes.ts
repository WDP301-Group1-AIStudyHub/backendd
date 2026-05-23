import { Router } from "express";
import {
  forgotPassword,
  login,
  logout,
  me,
  register,
  updateProfile,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "../validations/auth.validation";

const router = Router();

router.post("/register", validateRequest(registerSchema), register);
router.post("/login", validateRequest(loginSchema), login);
router.post("/logout", authMiddleware, logout);
router.get("/me", authMiddleware, me);
router.put(
  "/profile",
  authMiddleware,
  validateRequest(updateProfileSchema),
  updateProfile,
);
router.post(
  "/forgot-password",
  validateRequest(forgotPasswordSchema),
  forgotPassword,
);

export default router;
