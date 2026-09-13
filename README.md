# Embellishment Planning System

A comprehensive web application designed to manage, track, and streamline embellishment planning processes. The system features a robust, responsive frontend built with Next.js and Tailwind CSS, backed by an Express.js API and a Supabase (PostgreSQL) database.

---

## 🏗 System Architecture

The architecture is split into three main tiers:

1. **Frontend (Client Tier)**: Next.js (App Router) React application.
2. **Backend API (Server Tier)**: Node.js/Express.js server that acts as a secure intermediary for database operations and administrative tasks.
3. **Database & Auth (Data Tier)**: Supabase platform providing PostgreSQL database storage and secure user authentication (GoTrue).

### Workflow & Data Flow
- Users interact with the Next.js frontend, which holds local state and handles UI rendering.
- For data fetching and mutations, the frontend makes HTTP REST calls to the Express.js backend (`/api/*`).
- The backend verifies the user's authentication token (JWT) via Supabase, checks Role-Based Access Control (RBAC) permissions, and executes queries against the PostgreSQL database.
- Real-time updates or complex UI interactions (like inline editing) are managed via React state before being bulk-synced to the backend.

---

## ✨ Features

### 1. Interactive Planner Dashboard
- **Data Grid**: A large, scrollable table displaying up to 33 distinct columns of embellishment data (Status, Triggers, Graphics, Fabric Details, Dates, etc.).
- **Inline Editing**: Users with appropriate permissions can click directly into table cells to edit data.
- **Row Management**: Add new rows, duplicate existing rows, or select multiple rows for bulk deletion.

### 2. Advanced Filtering & Search
- **Global Search**: Search across multiple columns (Graphic, Style, Combo) instantly.
- **Plant Tabs**: Filter rows by specific manufacturing plants (e.g., Plant A, Plant B, Plant C).
- **Graphic Status Filter**: Toggle between viewing All items, Pending Graphics, or missing/blank fields.
- **Team Filter**: Filter visibility of rows based on the owning team (Team VS, Team CK, Team Pink).

### 3. Import & Export
- Import data directly via CSV or JSON files.
- Export the current view (or the entire dataset) to CSV for external reporting.

### 4. Role-Based Access Control (RBAC)
The system enforces strict access policies based on user roles:
- **Planner (Admin)**: Full access. Can create/edit/delete all rows, and access the Admin Gateway.
- **Management**: Broad visibility, typically for oversight.
- **Read-Only**: Can view the dashboard and use filters, but cannot modify, add, or delete data.
- **Team-Specific (Team VS, Team CK, Team Pink)**: Can only modify and interact with data assigned to their specific team.

### 5. Secure Admin Gateway (`/admin`)
- A completely separate, secure interface for administrators.
- Requires an explicit login step that validates `Planner` or `Admin` roles.
- Features a clean dashboard to **Provision New Users** and view the **User Directory**.
- Automatically handles Supabase email generation behind the scenes to simplify login (users only need to remember a username and password).

---

## 💻 Tech Stack

### Frontend
- **Framework**: Next.js 13+ (React 19)
- **Styling**: Tailwind CSS (with Dark Mode support)
- **State Management**: React Hooks (`useState`, `useEffect`, `useMemo`)
- **Routing**: Next.js App Router

### Backend
- **Server**: Node.js with Express.js
- **Middleware**: CORS, Express JSON parser, Custom Auth Middleware

### Database & Auth
- **Provider**: Supabase
- **Database**: PostgreSQL
- **Auth**: Supabase GoTrue (Email/Password)

---

## 🗄 Database Schema

The PostgreSQL database consists of two primary tables:

### 1. `rows` (Embellishment Data)
Stores the core planning data.
- `id` (TEXT, Primary Key): Unique identifier for the row.
- `col1` through `col33` (TEXT): Various text fields capturing specific embellishment metrics (e.g., `col1` = Status, `col33` = Approved Status, etc.).
- `team_owner` (TEXT): Identifies which team owns the row (e.g., "Team VS"). Null implies it is a general row created by a Planner.

### 2. `user_roles` (Access Control)
Maps Supabase Auth UUIDs to application-specific roles.
- `id` (SERIAL, Primary Key)
- `user_id` (UUID): Foreign key linking to Supabase's internal `auth.users` table.
- `role` (TEXT): The assigned role (e.g., 'Planner', 'Team Pink', 'Read-Only').
- `created_at` (TIMESTAMP): When the role was assigned.

---

## 🔒 Authentication & Logic Flow

1. **User Creation**: 
   - An Admin uses the `/admin` dashboard to create a user.
   - The frontend sends a username and password to `POST /api/admin/users`.
   - The Express backend sanitizes the username and generates a hidden email (`username@brandix.com`).
   - The backend registers the user with Supabase and inserts their assigned role into the `user_roles` table.

2. **Login**:
   - The user enters their username and password.
   - The frontend attempts to authenticate with Supabase using legacy (`@personal.local`) and new (`@brandix.com`) email formats.
   - Upon success, a JWT session token is stored.

3. **API Protection**:
   - Every request to `/api/rows` or `/api/admin` includes the JWT in the `Authorization: Bearer <token>` header.
   - The Express `authMiddleware` intercepts the request, verifies the JWT with Supabase, fetches the user's role from `user_roles`, and attaches it to the request object (`req.userRole`).
   - If a `Read-Only` user attempts a `POST`, `PUT`, or `DELETE`, the middleware immediately blocks it with a `403 Forbidden`.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- Bun (or npm/yarn)
- A Supabase Project (URL and Anon/Publishable Key)

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Set up your `.env.local` file:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
   NEXT_PUBLIC_API_URL=http://localhost:5001/api
   PORT=5001
   ```

### Running the Application
The project uses `concurrently` to run both the Next.js frontend and the Express.js backend simultaneously.

```bash
bun run dev:all
```
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5001

---

## 🛠 Database Environment & Sync Shortcuts

The application supports switching between the **Production / Original Database** and a **Testing Database** with single-line shortcut commands.

### 1. Database Switching Shortcuts
| Command | Alternative | Description |
| :--- | :--- | :--- |
| `bun run use:test` | `npm run use:test` | Switches both `.env.local` and `server/.env` to the **Testing Database** |
| `bun run use:prod` | `npm run use:prod` | Switches both `.env.local` and `server/.env` to the **Production / Original Database** |

*Note: Restart your dev server (`bun run dev:all`) after switching databases.*

### 2. Data Migration & Sync Shortcuts
| Command | Alternative | Description |
| :--- | :--- | :--- |
| `bun run sync:migrate` | `npm run sync:migrate` | Performs full data migration/copy from Production to Test DB |
| `bun run sync:watch` | `npm run sync:watch` | Runs real-time live listener to auto-mirror Production changes to Test DB |

---

### Deployment Notes
- For production, ensure the Express server is hosted (e.g., Render, Heroku, AWS) and update `NEXT_PUBLIC_API_URL` in the frontend environment variables to point to the live backend.
- Ensure CORS policies in `server/index.js` are restricted to the production frontend domain instead of `*`.
