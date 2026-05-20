import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const PLATFORM_JWT_SECRET = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';

export interface PlatformAdminRequest extends Request {
  platformAdmin?: {
    id: string;
    email: string;
  };
}

export const authenticatePlatformAdmin = (
  req: PlatformAdminRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, PLATFORM_JWT_SECRET) as any;
    if (decoded.type !== 'platform_admin') {
      return res.status(403).json({ error: 'Forbidden: Not a platform admin token' });
    }
    req.platformAdmin = { id: decoded.id, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const generatePlatformToken = (admin: { id: string; email: string }) => {
  return jwt.sign(
    { type: 'platform_admin', id: admin.id, email: admin.email },
    PLATFORM_JWT_SECRET,
    { expiresIn: '8h' },
  );
};
