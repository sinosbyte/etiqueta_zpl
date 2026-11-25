import { RequestUser } from '../auth/account';

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}
