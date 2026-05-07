# Family Shopping List

Small PHP + SQLite family shopping list app used to track items we need to get from a handful of stores. Runds as a webapp with persistenace if no connection.

## Setup

1. Update `config.php` with your real `base_url` and a long random `admin_secret`.
2. Serve the project from Apache/PHP 8 with SQLite enabled.
3. New users created by going to `/admin/?key=<admin_secret>`.

The SQLite database is created automatically at `data/app.sqlite` on first request.
