#!/usr/bin/env -S tsx --conditions=react-server

/**
 * msksim user-management CLI.
 *
 * Canonical invocation:
 *   npx tsx --conditions=react-server scripts/users.ts <subcommand> [args]
 *   npm run users -- <subcommand> [args]
 *   ./scripts/users.ts <subcommand> [args]   (when tsx is on PATH with --conditions)
 *
 * Subcommands:
 *   add <username> <password>            Create a user with an Argon2id-hashed password
 *   remove <username>                    Delete a user (sessions cascade automatically)
 *   list                                 Print all usernames, one per line
 *   change-password <username> <new>     Update a user's password
 *   --help, -h                           Show this message
 *
 * Exit codes:
 *   0   Success
 *   1   User-facing error (user not found, duplicate user, unexpected failure)
 *   2   Usage error (unknown subcommand, wrong argument count, unknown flag)
 *
 * Note: this file transitively imports server-only modules (lib/db/client,
 * lib/auth/password). The `server-only` package is a client-bundle guard that
 * passes through at Node runtime when the `react-server` export condition is
 * active (hence `--conditions=react-server` in the invocation).
 *
 * IMPORTANT: The subcommand names and positional-argument order are pinned to
 * scripts/run-plan.ts ensureSeedUser() (lines ~672–683), which calls:
 *   scripts/users.ts add <user> <pass>
 *   scripts/users.ts change-password <user> <pass>
 * Do not rename these subcommands or reorder their arguments.
 */

import { parseArgs } from 'node:util';

// loadEnvConfig must run before any module that reads process.env at load
// time (lib/env.ts). We use dynamic imports below for everything that
// transitively imports @/lib/db/client, matching the pattern in migrate.ts.
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const USAGE = `\
Usage: scripts/users.ts <subcommand> [args]

Subcommands:
  add <username> <password>            create a user
  remove <username>                    delete a user (cascades to sessions)
  list                                 print all usernames, one per line
  change-password <username> <new>     update a user's password
  --help, -h                           show this message
`.trimEnd();

async function main(): Promise<void> {
  // Dynamic imports ensure loadEnvConfig has already populated process.env
  // before lib/env.ts is evaluated (it reads process.env at module-load time).
  const {
    UserAlreadyExistsError,
    UserNotFoundError,
    addUser,
    changePassword,
    listUsers,
    removeUser,
  } = await import('./users-actions');

  let values: ReturnType<typeof parseArgs>['values'];
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      options: { help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: true,
    }));
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + '\n\n' + USAGE + '\n');
    process.exit(2);
  }

  if (values.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  if (positionals.length === 0) {
    process.stderr.write(USAGE + '\n');
    process.exit(2);
  }

  const subcommand = positionals[0];

  try {
    switch (subcommand) {
      case 'add': {
        if (positionals.length !== 3) {
          process.stderr.write('Usage: add <username> <password>\n');
          process.exit(2);
        }
        const [, username, password] = positionals;
        await addUser(username, password);
        process.stdout.write(`added user "${username}"\n`);
        break;
      }

      case 'remove': {
        if (positionals.length !== 2) {
          process.stderr.write('Usage: remove <username>\n');
          process.exit(2);
        }
        const [, username] = positionals;
        await removeUser(username);
        process.stdout.write(`removed user "${username}"\n`);
        break;
      }

      case 'list': {
        if (positionals.length !== 1) {
          process.stderr.write('Usage: list\n');
          process.exit(2);
        }
        const names = await listUsers();
        for (const name of names) {
          process.stdout.write(name + '\n');
        }
        break;
      }

      case 'change-password': {
        if (positionals.length !== 3) {
          process.stderr.write('Usage: change-password <username> <new-password>\n');
          process.exit(2);
        }
        const [, username, newPassword] = positionals;
        await changePassword(username, newPassword);
        process.stdout.write(`updated password for user "${username}"\n`);
        break;
      }

      default: {
        process.stderr.write(`Unknown subcommand: "${subcommand}"\n\n${USAGE}\n`);
        process.exit(2);
      }
    }
  } catch (err) {
    if (err instanceof UserAlreadyExistsError || err instanceof UserNotFoundError) {
      process.stderr.write(err.message + '\n');
    } else {
      process.stderr.write(
        (err instanceof Error ? err.stack ?? err.message : String(err)) + '\n'
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
