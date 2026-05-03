# GeoDuel

GeoDuel is a production-oriented online geography duel: ranked matchmaking, unranked friend rooms, public profiles, friends, achievements, server-owned timers, Supabase accounts, admin permissions, and deployment-ready frontend/backend config.

Project folder:

```bash
/Users/mohammadselo/Documents/GeoDuel
```

## Local Development

```bash
cd "/Users/mohammadselo/Documents/GeoDuel"
npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:3001
```

## Supabase Setup

1. Create a free Supabase project.
2. Open **SQL Editor**.
3. Paste and run:

```text
docs/supabase-schema.sql
```

4. Copy these from Supabase:

- Supabase URL
- anon public key
- service role key

The schema creates:

- `profiles`
- `matches`
- `analytics_events`
- `friend_requests`
- `friendships`
- `user_roles`
- `role_permissions`
- `bans`
- `audit_logs`
- `reports`

The backend uses the service role key for protected server actions. Never expose that key to the frontend.

## Render Backend

Deploy the backend to Render as a Node service.

Build command:

```bash
npm run server:build
```

Start command:

```bash
npm start
```

Set these backend environment variables on Render:

```bash
SUPABASE_URL=https://lgwmytgsqswjmwpkujhg.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
CLIENT_ORIGIN=https://geo-duel.vercel.app,http://localhost:5173
OWNER_EMAIL=you@example.com
ADMIN_EMAILS=admin1@example.com,admin2@example.com
ADMIN_TOKEN=optional-emergency-admin-token
PORT=3001
```

What each variable means:

- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_ANON_KEY`: public anon key used to verify Supabase Auth users.
- `SUPABASE_SERVICE_ROLE_KEY`: private backend key used for profiles, admin actions, friends, bans, audit logs, and match history.
- `CLIENT_ORIGIN`: comma-separated allowed browser origins. Include the deployed Vercel frontend URL exactly, for example `https://geo-duel.vercel.app`. Add `http://localhost:5173` for local testing.
- `OWNER_EMAIL`: the owner account email. Owner gets all permissions and can grant/revoke roles.
- `ADMIN_EMAILS`: comma-separated admin emails with baseline admin permissions.
- `ADMIN_TOKEN`: optional emergency admin token for `/admin`.
- `PORT`: Render usually provides this automatically; GeoDuel reads `process.env.PORT`.

## Vercel Frontend

Deploy the frontend to Vercel.

Build command:

```bash
npm run client:build
```

Output directory:

```text
client/dist
```

Set these frontend environment variables on Vercel:

```bash
VITE_SERVER_URL=https://your-render-backend.onrender.com
VITE_SUPABASE_URL=https://lgwmytgsqswjmwpkujhg.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

What each variable means:

- `VITE_SERVER_URL`: your deployed Render backend URL. The browser uses this for Socket.IO and API calls.
- `VITE_SUPABASE_URL`: your Supabase project URL. It must be copied exactly and must not include `/rest/v1` or `/auth/v1`.
- `VITE_SUPABASE_ANON_KEY`: public key used by Supabase Auth in the browser.

GeoDuel includes `vercel.json` so `/join/ROOMCODE`, `/admin`, `/privacy`, and `/terms` serve the React app.

Important: Vite bakes `VITE_*` values into the frontend bundle. After changing any Vercel env var, redeploy the Vercel project.

Supabase email confirmation: hosted Supabase projects usually require email confirmation by default. GeoDuel now consumes the confirmation redirect token from the URL, stores the session, and signs the player in automatically after they click the email link.

## Production Fix Checklist

For the current Supabase project, use this exact URL:

```bash
https://lgwmytgsqswjmwpkujhg.supabase.co
```

Common broken value:

```bash
https://lgwmytgsqswjmwpkuihjg.supabase.co
```

That typo swaps characters near the end and causes `ERR_NAME_NOT_RESOLVED`.

Set Vercel:

```bash
VITE_SUPABASE_URL=https://lgwmytgsqswjmwpkujhg.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
VITE_SERVER_URL=https://geoduel-backend.onrender.com
```

Set Render:

```bash
SUPABASE_URL=https://lgwmytgsqswjmwpkujhg.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
CLIENT_ORIGIN=https://geo-duel.vercel.app,http://localhost:5173
```

Then redeploy both Vercel and Render.

## Ranked Matchmaking

Ranked no longer uses private invite rooms.

Ranked flow:

1. Player signs in.
2. Player clicks **Ranked Matchmaking**.
3. Server verifies the auth token and checks bans.
4. Server puts the player in an in-memory ranked queue.
5. When another eligible player is waiting, the server creates a ranked match automatically.
6. No room code is shown for ranked.
7. Friends cannot be invited to ranked.
8. Ranked rematches are blocked; players must queue again.
9. Elo is only for server-created ranked matches.

Fixed ranked settings:

- 3 minutes per player
- Best of 3
- Whole World country pool
- Context map
- 10 second skip penalty
- 3 second wrong-answer penalty
- Forgiving spelling and aliases enabled
- Country menu disabled

## Unranked Rooms And Friends

Unranked rooms keep the custom settings:

- Timer length
- Skip penalty
- Wrong penalty
- Country pool
- Map mode
- No Skip mode
- Country menu
- Sound
- Spelling/aliases

Unranked rooms:

- Use room codes and invite links.
- Can be shared with friends.
- Do not affect Elo.
- Still use server-owned timers and answer validation.

Friends system:

- Search public profiles by display name.
- View another player profile.
- Send friend requests.
- Duplicate friend requests are handled safely and show “Friend request already sent” instead of crashing the server.
- Accept or decline requests.
- Remove friends.
- See basic presence: online, offline, in game, or queue.
- Invite friends to unranked rooms.

## Public Profiles

Public profiles show:

- Display name
- Elo
- Rank/title
- Win/loss record
- Achievements
- Recent matches when available
- Presence status

## Admin And Owner Permissions

Admin dashboard:

```text
/admin
```

Roles:

- `owner`
- `admin`
- `moderator`
- `support`

Permissions:

- `view_analytics`
- `view_users`
- `edit_elo`
- `ban_users`
- `unban_users`
- `kick_players`
- `force_end_games`
- `view_active_rooms`
- `manage_reports`
- `grant_roles`
- `revoke_roles`

Owner setup:

```bash
OWNER_EMAIL=you@example.com
```

The owner can grant/revoke roles and choose permissions for admins/moderators/support. Admin APIs are protected server-side; frontend role checks are display-only.

Admin dashboard features:

- Unlocks only after the backend confirms an owner/admin account or the private `ADMIN_TOKEN`.
- View analytics snapshots and recent event counts.
- View active rooms.
- Search users.
- View profile/stats.
- Edit player Elo with an audit-log reason.
- Ban/unban users.
- Assign/remove roles.
- Choose permissions.
- View audit logs.
- Kick players from active games.
- Force-end games.

The public footer does not link to `/admin`; keep the admin URL private and bookmark it as the owner.

Banned users cannot:

- Queue ranked.
- Create multiplayer rooms.
- Join multiplayer rooms.

They receive a clear ban message from the server.

## Analytics

GeoDuel stores simple analytics events in Supabase:

- Page visits
- Game starts
- Completed matches

No paid analytics tool is required.

## Future Ads

Ads are not enabled. Placeholder slots exist on:

- Home page
- Post-game screen

Add ad code later only after updating privacy/legal text.

## Legal Pages

Included:

- `/privacy`
- `/terms`

Review these before launch.

## Validation

Run before deploying:

```bash
npm run validate
npm run typecheck
npm run build
```

`npm run validate` confirms the 196-country list, map coverage/fallbacks, aliases, fuzzy examples, and dangerous false positives.

## Required Environment Variables

Supabase values to copy:

- Supabase URL
- anon public key
- service role key

Render backend:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLIENT_ORIGIN=
OWNER_EMAIL=
ADMIN_EMAILS=
ADMIN_TOKEN=
PORT=
```

Vercel frontend:

```bash
VITE_SERVER_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Troubleshooting

- **Ranked says sign in:** Supabase Auth env vars are missing or the user is signed out.
- **Ranked never matches:** Open two signed-in accounts in different browsers and queue both.
- **Admin says forbidden:** Set `OWNER_EMAIL`, `ADMIN_EMAILS`, or use `ADMIN_TOKEN`.
- **Friends do not save:** Confirm `docs/supabase-schema.sql` was run and backend has `SUPABASE_SERVICE_ROLE_KEY`.
- **Friend request already sent:** This is expected when a pending request exists; refresh the Friends tab to see outgoing requests.
- **Frontend cannot reach backend:** Set Vercel `VITE_SERVER_URL` to Render URL and Render `CLIENT_ORIGIN` to Vercel URL.
- **CORS errors:** `CLIENT_ORIGIN` must include the exact deployed frontend origin. GeoDuel normalizes trailing slashes and shares the same allowlist between Express and Socket.IO.
- **Supabase DNS error:** `VITE_SUPABASE_URL` is wrong. Copy the exact project URL from Supabase, then redeploy Vercel.
- **Authentication failed after signup:** Confirm the email link first. If Supabase redirects back to GeoDuel with an access token, the app stores that session automatically.
- **Invalid login credentials:** The email/password is wrong or the email has not been confirmed yet. Supabase Auth logs will show `invalid_credentials` for this case.
