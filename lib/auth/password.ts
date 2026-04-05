import 'server-only';

import { hash, verify } from '@node-rs/argon2';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

// Note: the library's verify signature is verify(hashed, password), but we
// expose the more conventional (plain, hash) order to match call sites like
// verifyPassword(formData.password, user.passwordHash).
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return verify(hashed, plain);
}
