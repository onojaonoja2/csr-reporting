# Elkris Reporting

A multi-role sales reporting application for managing CSR (Community Sales Representative) sales, attendance, inventory, and commissions.

## Roles

- **Admin** — User management, product management, system oversight
- **Supervisor** — Daily sales logging, CSR management, attendance, inventory, payment confirmation, month-end archival
- **Manager** — Read-only reports (daily/weekly/monthly views), payment confirmation, CSR removal
- **CSR** — Sales logging access (same dashboard as supervisor with limited scope)

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 4
- **Templating:** EJS
- **Database:** MySQL 8 (via mysql2 + Sequelize ORM)
- **Migrations:** Umzug 3 (programmatic, run on startup)
- **Session:** express-session
- **Rate Limiting:** express-rate-limit
- **Spreadsheet Export:** xlsx
- **Styling:** Tailwind CSS (CDN)

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL 8+

### Installation

```bash
git clone <repo-url> csr-reporting
cd csr-reporting
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
PORT=3000
SESSION_SECRET=your-secret-here
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=elkris_csr
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=10
GLOBAL_RATE_LIMIT_WINDOW_MS=900000
GLOBAL_RATE_LIMIT_MAX=200
```

### Run

```bash
npm start        # production
npm run dev      # development (with nodemon)
```

The database, tables, and seed data are created automatically on first startup.

## Features

### Daily Operations
- Log sales per CSR with product selection, quantity, and unit price
- Mark CSR as present/absent (with or without sales)
- Bulk "All Present" button
- Close/reopen day (prevents further edits)

### Monthly Management
- End Month — archives the current month, blocking further edits
- Open Month — reverses archival
- Auto-archive — previous months are archived automatically when a new month begins

### Reporting
- Daily, weekly, and monthly activity views
- Pay table with earned pay calculation based on tier targets
- Payment confirmation (single and bulk)
- Excel export for pay table
- Previous day view
- Removed CSRs with outstanding pay tracking

### CSR Management
- Create, edit, remove CSRs
- Assign target tiers
- Manage inventory per CSR
- Search/filter CSR table on dashboard

### Admin
- Full user CRUD (hard delete with optional data reassignment)
- Product CRUD
- Role assignment

### User Interface
- Responsive design (mobile hamburger menu, scrollable tables)
- Dark/light theme toggle (persisted to localStorage)
- Collapsible sidebar (persisted to localStorage)
- Toast notifications for success/error feedback
- Custom confirmation modals (replaces browser alerts)
- Rate-limited login

## Database

Tables are created with `CREATE TABLE IF NOT EXISTS` so existing data is never lost. Migrations run on every startup via Umzug.

### Tables

- `users` — All system users (admin, supervisor, manager, CSR)
- `products` — Product catalog
- `target_tiers` — Commission tiers (monthly target + salary)
- `csr_tier` — CSR-to-tier assignments
- `csr_inventory` — Product inventory per CSR
- `sales_entries` — Daily sales/attendance records
- `sales_entry_items` — Line items per sales entry
- `payment_history` — Confirmed payments
- `archived_months` — Archived (closed) months

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start production server |
| `npm run dev` | Start with nodemon |
| `npm run migrate` | Run pending Sequelize migrations |
| `npm run migrate:undo` | Roll back last migration |
| `npm run migrate:create -- --name <name>` | Create a new migration file |

## Project Structure

```
├── config/             # DB config, geopolitical data
├── data/               # Legacy/stale SQLite files
├── middleware/          # Auth guards
├── migrations/         # Umzug/Sequelize migrations
├── models/             # Sequelize model definitions
├── public/             # Static assets (CSS, JS)
├── routes/             # Express route handlers
│   ├── auth.js
│   ├── admin.js
│   ├── supervisor.js
│   └── manager.js
├── views/              # EJS templates
│   ├── partials/       # Header, sidebar, footer
│   ├── admin/
│   ├── supervisor/
│   └── manager/
├── .env                # Environment variables
├── db.js               # Database connection + migrations runner
├── server.js           # App entry point
└── package.json
```
