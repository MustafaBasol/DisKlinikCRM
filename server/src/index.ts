import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import whatsappRoutes from './routes/whatsapp.js';
import usersRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import patientsRoutes from './routes/patients.js';
import servicesRoutes from './routes/services.js';
import appointmentRequestsRoutes from './routes/appointmentRequests.js';
import appointmentsRoutes from './routes/appointments.js';
import tasksRoutes from './routes/tasks.js';
import treatmentCasesRoutes from './routes/treatmentCases.js';
import insuranceProvisionsRoutes from './routes/insuranceProvisions.js';
import paymentsRoutes from './routes/payments.js';
import messagesRoutes from './routes/messages.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Unprotected routes
app.use('/api/auth', authRoutes);
app.use('/api/public/whatsapp', whatsappRoutes);

// Global auth middleware for all /api routes below
app.use('/api', authenticate as express.RequestHandler);

// Protected routes
app.use('/api', usersRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', patientsRoutes);
app.use('/api', servicesRoutes);
app.use('/api', appointmentRequestsRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api', tasksRoutes);
app.use('/api', treatmentCasesRoutes);
app.use('/api', insuranceProvisionsRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', messagesRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
