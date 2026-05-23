import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

export const connectDatabase = async (): Promise<void> => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "";

  if (!mongoUri) {
    throw new Error("MONGO_URI is required");
  }

  const connection = await mongoose.connect(mongoUri);
  console.log(`MongoDB connected: ${connection.connection.host}`);
};
