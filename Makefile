PNPM ?= pnpm
NPM ?= npm
EXTENSION ?= installable-extensions/coffee

.PHONY: help setup dev use start build check test test-node test-bdd-smoke db db-deploy db-status db-reset extensions extension-dev extension-build release-smoke

help:
	@printf "\nJingle public development commands\n\n"
	@printf "Setup:\n"
	@printf "  make setup             Install dependencies, generate Prisma client, migrate the Jingle DB\n"
	@printf "Develop:\n"
	@printf "  make dev               Start Jingle in development mode\n"
	@printf "  make check             Run lint, typecheck, and architecture guardrails\n"
	@printf "  make test              Run node tests and the BDD smoke suite\n"
	@printf "  make build             Build the app, installed extensions, and native helpers\n\n"
	@printf "Use:\n"
	@printf "  make use               Build and launch a local Jingle preview\n"
	@printf "  make start             Launch the most recent local Jingle preview build\n"
	@printf "  make db-status         Show Jingle DB migration status\n\n"
	@printf "Maintain:\n"
	@printf "  make db                Apply Jingle DB migrations\n"
	@printf "  make db-reset          Reset the local Jingle DB\n"
	@printf "  make extensions        Build and check installed extensions\n"
	@printf "  make extension-dev     Run an extension in dev mode; set EXTENSION=path\n"
	@printf "  make release-smoke     Build, check, and run npm pack dry-run\n\n"

setup:
	$(PNPM) install
	$(PNPM) exec prisma generate
	$(MAKE) db-deploy

dev:
	$(PNPM) run dev

use: build start

start:
	$(PNPM) run start

build:
	$(PNPM) run build

check:
	$(PNPM) run lint
	$(PNPM) run typecheck
	node scripts/guardrails/check-guardrails.mjs
	node scripts/guardrails/check-extension-packages.mjs

test: test-node test-bdd-smoke

test-node:
	$(PNPM) run test:node

test-bdd-smoke:
	$(PNPM) run test:bdd:smoke

db: db-deploy

db-deploy:
	node scripts/run-prisma-jingle-db.mjs migrate deploy

db-status:
	node scripts/run-prisma-jingle-db.mjs migrate status

db-reset:
	node scripts/run-prisma-jingle-db.mjs migrate reset --force

extensions:
	node scripts/build-installed-extension.mjs
	$(PNPM) exec tsx --tsconfig tsconfig.node.json scripts/check-native-extensions.mjs

extension-dev:
	$(PNPM) exec jingle-extension dev $(EXTENSION)

extension-build:
	$(PNPM) exec jingle-extension build $(EXTENSION)

release-smoke:
	$(MAKE) build
	$(MAKE) check
	$(NPM) pack --dry-run
