import { prisma } from '../../prisma';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { JWT_EXPIRES_IN, JWT_SECRET, JwtPayload } from '../middleware/auth.middleware';
import log from '../../logger';
import { User } from '@prisma/client';
import { generateAccessKey } from '../../utils/auth';


// Salt rounds for bcrypt
const SALT_ROUNDS = 10;

/**
 * User service for handling user-related operations
 */
export class UserService {
  /**
   * Create a new user
   */
  async createUser({
    username,
    password,
    firstname,
    lastname,
    role,
  }: Pick<User, 'username' | 'password' | 'firstname' | 'lastname' | 'role'>) {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        throw new Error('User already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const accessKey = generateAccessKey(username);

      // Create user
      const user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          role,
          firstname,
          lastname,
          accessKey,
          isActive: true,
        },
      });

      // Return user without password
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isActive: user.isActive,
        accessKey: user.accessKey,
      };
    } catch (error) {
      log.error(`Error creating user: ${error}`);
      throw error;
    }
  }

  /**
   * Authenticate user and generate JWT token
   */
  async login(username: string, password: string) {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { username },
      });

      if (!user) {
        throw new Error('Invalid credentials');
      }

      // Compare passwords
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        throw new Error('Invalid credentials');
      }

      if (!user.isActive) {
        throw new Error('User is not active');
      }

      // Generate JWT token
      const payload: JwtPayload = {
        userId: user.id,
        username: user.username,
        role: user.role,
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions);

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          firstname: user.firstname,
          lastname: user.lastname,
          accessKey: user.accessKey,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          isActive: user.isActive,
        },
      };
    } catch (error) {
      log.error(`Error during login: ${error}`);
      throw error;
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

      if (!isPasswordValid) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      return { success: true };
    } catch (error) {
      log.error(`Error changing password: ${error}`);
      throw error;
    }
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return users;
    } catch (error) {
      log.error(`Error getting users: ${error}`);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          role: true,
          accessKey: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      log.error(`Error getting user: ${error}`);
      throw error;
    }
  }

  /**
   * Get user by accessKey
   */
  async getUserByAccessKey(accessKey: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { accessKey },
        select: {
          id: true,
          username: true,
          firstname: true,
          lastname: true,
          role: true,
          accessKey: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      log.error(`Error getting user: ${error}`);
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string) {
    try {
      await prisma.user.delete({
        where: { id: userId },
      });

      return { success: true };
    } catch (error) {
      log.error(`Error deleting user: ${error}`);
      throw error;
    }
  }

  /**
   * Delete user
   */
  async updateUser(
    userId: string,
    data: Pick<User, 'firstname' | 'lastname' | 'role' | 'password'>,
  ) {
    try {
      if (data.password) {
        const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
        data.password = hashedPassword;
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          firstname: data.firstname,
          lastname: data.lastname,
          role: data.role,
          ...(data.password && { password: data.password }),
        },
      });

      return { success: true };
    } catch (error) {
      log.error(`Error deleting user: ${error}`);
      throw error;
    }
  }

  /**
   * Create initial admin user if no users exist
   */
  async createInitialAdminIfNeeded() {
    try {
      const userCount = await prisma.user.count({
        where: {
          role: 'admin',
        },
      });

      if (userCount === 0) {
        // Create default admin user
        const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
        const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD; // CWE-259 Hardcoded Password

        if (!defaultAdminPassword) {
          throw new Error('DEFAULT_ADMIN_PASSWORD must be defined in environment variables');
        }

        await this.createUser({
          username: defaultAdminUsername,
          password: defaultAdminPassword,
          role: 'admin',
          firstname: 'Admin',
          lastname: 'User',
        });
        log.info(`Created initial admin user: ${defaultAdminUsername}`);
      }
    } catch (error) {
      log.error(`Error creating initial admin: ${error}`);
    }
  }

  async activateUser(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
  }

  async deactivateUser(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
  }

  async getDefaultUser() {
    return await prisma.user.findFirst({
      where: {
        role: 'admin',
      },
    });
  }
}

export const userService = new UserService();
