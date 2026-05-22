import express from "express";
import {
  googleAuth,
  googleCallback,
  handleChangePassword,
  loginUser,
  registerUser,
  getAllUsers,
  getUserById,
  updateUser,
} from "../controllers/user.controller";
import { authMiddleware, requireAdmin } from "../../../middlewares/auth";
const userRouter = express.Router();

userRouter.post("/register", registerUser);
userRouter.post("/login", loginUser);
userRouter.get("/auth/google", googleAuth);
userRouter.get("/auth/google/callback", googleCallback);
userRouter.put("/password/change", handleChangePassword);

// New routes - protected with authentication
userRouter.get("/", authMiddleware, getAllUsers);
userRouter.get("/:id", authMiddleware, getUserById);
userRouter.put("/:id", authMiddleware, updateUser);

export default userRouter;
