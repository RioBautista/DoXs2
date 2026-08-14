import type { LoginUser } from '@doxs/shared';

export type AuthSession = {
  user: LoginUser;
  clientSlug: string | null;
};
