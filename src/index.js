import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupSocketio } from './socket/index.js';
import { startPushScheduler } from './cron/pushScheduler.js';
import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';
import { riderRouter } from './routes/riders.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { publicRouter } from './routes/public.js';
import { deviceRouter } from './routes/device.js';
import { vendorRouter } from './routes/vendors.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestMeta } from './middleware/requestMeta.js';
import { franchiseMiddleware } from './middleware/franchise.js';
import { rateLimiter } from './middleware/rateLimiter.js';

const app = express();
app.use(express.json());
app.use(requestMeta); // attaches req.requestId, sets X-Request-ID header

// Public routes (no franchise required)
app.use('/api/v1/auth', rateLimiter('auth'), authRouter);
app.use('/api/v1/public', rateLimiter('public'), publicRouter);

// All other routes require franchise header
app.use('/api/v1', franchiseMiddleware);
app.use('/api/v1/device', deviceRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/riders', riderRouter);
app.use('/api/v1/marketplace', marketplaceRouter);
app.use('/api/v1/vendors', vendorRouter);
app.use('/api/v1/admin', adminRouter);

app.use(errorHandler);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
setupSocketio(io);
startPushScheduler();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`DropPutt API listening on :${PORT}`));

export { io };
