import { Router } from "express";
import {
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  register,
  resetPassword,
  updateProfile,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
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
router.post(
  "/reset-password",
  validateRequest(resetPasswordSchema),
  resetPassword,
);
router.post(
  "/change-password",
  authMiddleware,
  validateRequest(changePasswordSchema),
  changePassword,
);

export default router;
