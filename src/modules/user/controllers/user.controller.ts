import { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import { User } from "../models/user.model";
import generateToken from "../../../utils/generateToken";
import { comparePassword, hashPassword } from "../../../utils/hasPassword";
import passport from "passport";
import config from "../../../configs/config";
import { IUser } from "../../../types/user.type";
export const registerUser = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const { userFirstName, userLastName, email, phoneNumber, YOB, password } =
    req.body;
  try {
    let user = await User.findOne({ email });
    if (user) {
      res.status(400).json({ message: "Email already exists" });
    }
    user = new User({
      userFirstName,
      userLastName,
      YOB,
      email,
      phoneNumber,
      password,
    });

    // const salt = await bcrypt.genSalt(10);
    // user.password = await bcrypt.hash(password, salt);

    user.password = await hashPassword(user.password);
    await user.save();
    user.monthlyBudget = 0;
    // user.balance = 0;
    user.plan = "free";
    await user.save();

    // uncoment nếu muốn register xong đăng nhập luôn
    // const token = generateToken(user)

    res.status(201).json({
      message: "register succesfully",
      // token
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("server error at resigter");
  }
};
export const loginUser = async (req: Request, res: Response): Promise<any> => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Email doesn't exist" });
    }

    if (user.isLocked) {
      return res.status(403).json({
        message: "Account is locked. Please contact admin."
      });
    }
    // const isMatch = await bcrypt.compare(password, user.password);
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }
    const token = generateToken(user);
    res.status(200).json({
      message: "Login successful",
      success: true,
      token,
    });
  } catch (err: any) {
    res.status(500).send("Error at login");
  }
};
export const googleAuth = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate("google", { scope: ["profile", "email"] })(
    req,
    res,
    next,
  );
};
export const googleCallback = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const frontendUrl = config.FRONTEND_URL;
  passport.authenticate(
    "google",
    { failureRedirect: `${frontendUrl}/auth/login?error=auth_failed` },
    (err: any, user: IUser) => {
      if (err) {
        console.error("Authentication error:", err);
        return res.redirect(`${frontendUrl}/auth/login?error=auth_failed`);
      }
      if (user) {
        if (user.isLocked) {
          return res.redirect(`${frontendUrl}/auth/login?error=account_locked`);
        }

        const token = generateToken(user);
        // Redirect to frontend with token
        return res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
      }
      return res.redirect(`${frontendUrl}/auth/login?error=no_user`);
    },
  )(req, res, next);
};
export const handleChangePassword = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const { id, oldPassword, newPassword } = req.body;
  try {
    const user = await User.findById({ _id: id });
    if (!user) {
      return res.status(404).json({ message: "user doesnot exists" });
    }
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "password is not match" });
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    res.json({ message: "Đổi mật khẩu thành công" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

// Get all users
export const getAllUsers = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: error.message,
    });
  }
};

// Get user by ID
export const getUserById = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error fetching user",
      error: error.message,
    });
  }
};

// Update user
export const updateUser = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove sensitive fields that shouldn't be updated through this endpoint
    delete updateData.password;
    delete updateData.isAdmin;
    delete updateData.googleId;

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: user,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error updating user",
      error: error.message,
    });
  }
};
