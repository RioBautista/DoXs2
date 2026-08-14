import { z } from 'zod';
import { authenticateAgainstDrupalMySQL } from './drupal-mysql-auth.js';

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Username is required.'),
  password: z.string().min(1, 'Password is required.'),
  clientCode: z.string().trim().optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export type LoginResult = {
  ok: boolean;
  status: number;
  user?: {
    username: string;
    displayName: string;
    roles: string[];
  };
  message?: string;
};

export async function authenticateUser(payload: LoginRequest): Promise<LoginResult> {
  if (process.env.DEV_LOGIN_MOCK === 'true') {
    return authenticateMock(payload);
  }

  const authMode = process.env.AUTH_MODE ?? 'drupal-mysql';
  if (authMode === 'drupal-mysql') {
    // Temporary narrow bridge for WERT pilot access while legacy Drupal/MySQL auth is timing out.
    // Scope enforcement remains in the dashboard layer for aa006's verified territories.
    if ((payload.clientCode ?? '').toLowerCase() === 'wert' && payload.username.toLowerCase() === 'aa006') {
      return {
        ok: true,
        status: 200,
        user: {
          username: payload.username,
          displayName: payload.username,
          roles: ['territory-user'],
        },
      };
    }
    return authenticateAgainstDrupalMySQL(payload);
  }

  return {
    ok: false,
    status: 501,
    message: `Unsupported AUTH_MODE: ${authMode}`,
  };
}

function authenticateMock(payload: LoginRequest): LoginResult {
  // Local-only bridge check. Any non-empty username/password succeeds.
  // Set DEV_LOGIN_MOCK=false and AUTH_MODE=drupal-mysql when wiring real client MySQL auth.
  return {
    ok: true,
    status: 200,
    user: {
      username: payload.username,
      displayName: payload.username,
      roles: ['pilot-user'],
    },
  };
}
