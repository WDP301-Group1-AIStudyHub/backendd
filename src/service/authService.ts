import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { googleConfig } from "../configs/googleConfig";
import { hashPassword } from "../utils/hasPassword";
import { User } from "../modules/user/models/user.model";

passport.use(
  new GoogleStrategy(
    {
      clientID: googleConfig.clientID,
      clientSecret: googleConfig.clientSecret,
      callbackURL: googleConfig.callBackURL,
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: any,
      done: Function,
    ) => {
      try {
        const { id, emails, name } = profile;
        const existingUser = await User.findOne({ googleId: id });
        if (existingUser) {
          return done(null, existingUser);
        }
        const password = "randomPassword123";
        const hasedPassword = await hashPassword(password);
        const newUser = new User({
          googleId: id,
          email: emails[0].value,
          userFirstName: name.givenName || "User",
          userLastName: name.familyName || "Google",
          password: hasedPassword,
          YOB: new Date("2000-01-01"), // Default YOB
          gender: true, // Default to male
        });
        await newUser.save();
        return done(null, newUser);
      } catch (err: any) {
        return done(err, null);
      }
    },
  ),
);
