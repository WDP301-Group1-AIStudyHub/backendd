import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middlewares/auth.middleware';
import {
  saveCredentialHandler,
  getCredentialStatusHandler,
  getUsageHandler,
  deleteCredentialHandler,
} from '../controllers/aiCredential.controller';

const router = Router();

const credentialSaveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 submissions per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many credential submission attempts. Please try again later.',
  },
});

router.use(authMiddleware);

router.post('/credential', credentialSaveLimiter, saveCredentialHandler);
router.get('/credential', getCredentialStatusHandler);
router.delete('/credential', deleteCredentialHandler);
router.get('/usage', getUsageHandler);

export default router;
