import 'server-only';

// Re-export all schema entities so callers can use '@/lib/db/schema'
// instead of reaching into 'db/schema/' directly.
// Entity exports are added here as steps 03, 04, and 08 land.

export * from '@/db/schema';
