import mongoose from "mongoose";
import config from "./config";

const connectDB = async () => {
  try {
    const connect = await mongoose.connect(config.MONGODB_URI!);
    console.log("MongoDB connected: ", connect.connection.host);
  } catch (err: any) {
    console.log("error: ", (err as Error).message);
    process.exit(1);
  }
};
export default connectDB