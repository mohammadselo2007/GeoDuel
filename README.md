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
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
CLIENT_ORIGIN=https://your-geoduel-frontend.vercel.app
OWNER_EMAIL=you@example.com
ADMIN_EMAILS=admin1@example.com,admin2@example.com
ADMIN_TOKEN=optional-emergency-admin-token
PORT=3001
```

What each variable means:

- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_ANON_KEY`: public anon key used to verify Supabase Auth users.
- `SUPABASE_SERVICE_ROLE_KEY`: private backend key used for profiles, admin actions, friends, bans, audit logs, and match history.
- `CLIENT_ORIGIN`: the deployed Vercel frontend URL. This controls CORS.
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
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

What each variable means:

- `VITE_SERVER_URL`: your deployed Render backend URL. The browser uses this for Socket.IO and API calls.
- `VITE_SUPABASE_URL`: your Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: public key used by Supabase Auth in the browser.

Add a Vercel SPA rewrite so `/join/ROOMCODE`, `/admin`, `/privacy`, and `/terms` serve the React app.

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

- View analytics snapshot.
- Search users.
- View profile/stats.
- Ban/unban users.
- Assign/remove roles.
- Choose permissions.
- View audit logs.
- Kick players from active games.
- Force-end games.

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
- **Frontend cannot reach backend:** Set Vercel `VITE_SERVER_URL` to Render URL and Render `CLIENT_ORIGIN` to Vercel URL.
- **CORS errors:** `CLIENT_ORIGIN` must exactly match the deployed frontend origin.
