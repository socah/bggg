import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthGuard implements CanActivate {
  // NestJS calls canActivate before every handler this guard protects.
  // Returning true lets the request through; throwing blocks it with 401.
  canActivate(context: ExecutionContext): boolean {
    const token = this.extractToken(context);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // jwt.verify checks the signature AND expiry in one call.
      // It throws JwtExpiredError, JsonWebTokenError, etc. on any failure —
      // we catch all of them uniformly and return the same 401.
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;

      // Attach the decoded payload to the request so any controller can read
      // req.user.sub (the user's ID) without decoding the token a second time.
      const request = context.switchToHttp().getRequest();
      request.user = payload;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // All transport-specific logic lives here — canActivate never calls
  // switchToHttp() or switchToWs() directly. When WebSockets are added in
  // Phase 3, only this method grows a new branch; nothing else changes.
  private extractToken(context: ExecutionContext): string | null {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      // Authorization header format: "Bearer <token>"
      // split(' ')[1] isolates the token part after the space.
      return request.headers.authorization?.split(' ')[1] ?? null;
    }
    // 'ws' branch will be added here in Phase 3 when group chat is built.
    return null;
  }
}
