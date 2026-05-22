import express, { Request, Response } from "express";
import cors from "cors";
import connectDB from "./configs/db";
import userRoutes from "./modules/user/routes/user.route";

import passport from "passport";
import "./service/authService";


const app = express();
const apiRouter = express.Router();

//middleware
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

//routes
apiRouter.use("/user", userRoutes);


app.use("/api/v1", apiRouter);
//coonectDB
connectDB();

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
//abc
