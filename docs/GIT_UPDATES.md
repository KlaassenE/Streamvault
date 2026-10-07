# Git setup and production updates

Repository: https://github.com/KlaassenE/Streamvault

The Git root is the new application itself. The legacy Laravel project, dependencies, build output, demo folders, local databases, backups, and .env.local are not committed. The feature inventory and design notes are in docs so the legacy checkout is not needed.

## Developer Mac

Git is initialized on main with origin pointing to the repository. Set your commit identity for this repository if it is not configured:

```sh
git config user.name "Your name"
git config user.email "Your GitHub email or GitHub no-reply email"
git add .
git commit -m "Create Streamvault application"
git push -u origin main
```

Only push after validation. HTTPS pushing needs GitHub authentication; a GitHub account password will not work as the Git credential. Use your configured credential helper, GitHub CLI login, or an SSH remote. Do not put credentials in repository files or the remote URL.

## Connect the existing production Mac after the first push

Keep your existing data path unchanged. If you used the setup instructions, it is outside the project at ~/Library/Application Support/Streamvault. From the currently installed application directory, make a backup first:

```sh
STREAMVAULT_DATA_DIR="$HOME/Library/Application Support/Streamvault" pnpm backup "$HOME/Desktop/streamvault-before-git.sqlite"
```

Use your actual configured data path if different, and a new filename if that backup already exists. CLI commands do not automatically load .env.local. Wait for indexing jobs to finish and stop the server with Ctrl+C. Still in the old project directory:

```sh
git clone https://github.com/KlaassenE/Streamvault.git ../streamvault-git
cp .env.local ../streamvault-git/.env.local
cd ../streamvault-git
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

If Git is not installed, macOS may prompt to install Command Line Tools; alternatively run `xcode-select --install`. A private repository also needs authentication for cloning/pulling.

Do not recreate .env.local during this switch. If STREAMVAULT_DATA_DIR is a relative path such as ./data, move/copy that data directory into the new clone while the old server and workers are stopped, or change the configuration to its existing absolute location. Copying only configuration is sufficient when the data path is already external and absolute. Original video folders must stay mounted at the same paths. Retain the old application folder until the new clone works.

## Later production updates

On the developer Mac, commit validated changes and run git push. On the hosting Mac, create a dated database backup, wait for indexing to finish, and stop the server. In its streamvault-git folder:

```sh
git pull --ff-only && pnpm install --frozen-lockfile && pnpm build && pnpm start
```

The && chain stops if pulling, installing or building fails. git pull only updates tracked application files; configuration and databases are ignored. Accounts, sessions, local comments, likes, subscriptions, indexing and watch state stay in the same persistent data directory. No re-index is needed for code-only updates. Keep the same browser address to retain the login cookie.

Keep production source unchanged locally so pulls can fast-forward cleanly. If Git reports local changes, inspect git status instead of forcing an update. Do not use git clean -fdx: it deletes ignored configuration and project-local data. Releases with incompatible schema changes need a migration and matching database backup for rollback.
