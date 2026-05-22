import jwt from "jsonwebtoken";
import config from "../configs/config";
import { IUser } from "../types/user.type";
const generateToken = (user: IUser) => {
  return jwt.sign({ userId: user._id , email: user.email, userFirstName: user.userFirstName, userLastName: user.userLastName, isAdmin: user.isAdmin, plan: user.plan}, config.JWT_SECRET, {
    expiresIn: "1h",
  });
};
export default generateToken;