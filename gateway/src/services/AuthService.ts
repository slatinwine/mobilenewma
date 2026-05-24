// Authentication Service - JWT, password hashing, encryption

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export class AuthService {
  private jwtSecret: string;
  private accessTokenExpiry: string = '7d';
  private refreshTokenExpiry: number = 30 * 24 * 60 * 60 * 1000; // 30 days
  private encryptionKey: Buffer;
  private algorithm = 'aes-256-gcm';

  constructor(jwtSecret: string, encryptionKey: string) {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.jwtSecret = jwtSecret;

    // Derive 32-byte key for AES-256
    this.encryptionKey = createHash('sha256').update(encryptionKey).digest();
  }

  // Password hashing
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  // JWT tokens
  generateAccessToken(userId: string, username: string): string {
    return jwt.sign(
      {
        userId,
        username,
        type: 'access'
      },
      this.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  generateRefreshToken(): string {
    return randomBytes(64).toString('hex');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  verifyAccessToken(token: string): { userId: string; username: string } | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      if (decoded.type !== 'access') return null;
      return {
        userId: decoded.userId,
        username: decoded.username
      };
    } catch (error) {
      return null;
    }
  }

  // AES-256-GCM encryption for API keys
  encryptApiKey(text: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv) as any;

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag() as Buffer;

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  decryptApiKey(encrypted: string, ivHex: string, authTagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv) as any;
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  getRefreshTokenExpiry(): number {
    return Date.now() + this.refreshTokenExpiry;
  }
}
