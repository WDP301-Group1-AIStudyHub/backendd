import dotenv from "dotenv";
dotenv.config();
export const googleConfig = {
  clientID: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  callBackURL: process.env.GOOGLE_CALLBACK_URL || "",
};
