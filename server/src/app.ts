import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import healthRoutes from './routes/healthRoutes';
import indexRoutes from './routes/indexRoutes';
import chatRoutes from './routes/chatRoutes';
import authRoutes from './routes/authRoutes';
import userAuthRoutes from './routes/userAuthRoutes';
import conversationRoutes from './routes/conversationRoutes';
import profileRoutes from './routes/profileRoutes';
import schedulerRoutes from './routes/schedulerRoutes';
import licenseRoutes from './routes/licenseRoutes';
import adminRoutes from './routes/adminRoutes';
import configRoutes from './routes/configRoutes';
import tenantRoutes from './routes/tenantRoutes';
import integrationRoutes from './routes/integrationRoutes';
import logRoutes from './routes/logRoutes';
import tierRoutes from './routes/tierRoutes';
import tokenUsageRoutes from './routes/tokenUsageRoutes';

const app = express();

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// CORS
app.use(cors({
  origin: env.clientUrl,
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/user', userAuthRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/schedules', schedulerRoutes);
app.use('/api/licenses', licenseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/config', configRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/integration', integrationRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/tiers', tierRoutes);
app.use('/api/usage', tokenUsageRoutes);
app.use('/api/index', indexRoutes);
app.use('/api/chat', chatRoutes);

// Error handler
app.use(errorHandler);

export default app;
