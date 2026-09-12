#!/usr/bin/env bash
set -euo pipefail

# Used by the `release.yml` workflow (as the changesets/action `version` command)
# to bump package versions and update changelogs.
#
# `changeset version` generates changelog entries via the GitHub GraphQL API
# (@changesets/changelog-github), which intermittently fails with transient
# network errors like "Premature close". changesets bails cleanly without
# writing files on that failure, so retrying is safe.

attempts=5
delay=5

for attempt in $(seq 1 "$attempts"); do
	if pnpm changeset version; then
		break
	fi

	if [ "$attempt" -eq "$attempts" ]; then
		echo "\"pnpm changeset version\" failed after ${attempts} attempts." >&2
		exit 1
	fi

	echo "\"pnpm changeset version\" failed (attempt ${attempt}/${attempts}), retrying in ${delay}s..." >&2
	sleep "$delay"
done

# pnpm install --no-frozen-lockfile
