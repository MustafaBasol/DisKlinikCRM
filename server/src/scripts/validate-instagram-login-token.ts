/**
 * Validate an Instagram Login / Instagram API token against graph.instagram.com.
 *
 * Usage:
 *   INSTAGRAM_ACCESS_TOKEN=<token> npm run validate:instagram-token
 *   npm run validate:instagram-token -- <token>
 */

import { validateInstagramLoginToken } from '../services/instagram/InstagramMessagingProvider.js';

const EXPECTED_ID = '17841477329539113';
const EXPECTED_USERNAME = 'autoviseo';

async function main() {
  const token = (process.argv[2] ?? process.env.INSTAGRAM_ACCESS_TOKEN ?? '').trim();
  if (!token) {
    console.error('Missing token. Pass it as an argument or set INSTAGRAM_ACCESS_TOKEN.');
    process.exit(1);
  }

  const result = await validateInstagramLoginToken(token);
  if (!result.success) {
    console.error(result.message);
    process.exit(1);
  }

  console.log('Instagram token validation result:', {
    id: result.accountId,
    username: result.username,
    expectedId: EXPECTED_ID,
    expectedUsername: EXPECTED_USERNAME,
  });

  if (result.accountId !== EXPECTED_ID || result.username !== EXPECTED_USERNAME) {
    console.error('Token validated, but the returned Instagram account did not match the expected account.');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
