# Herdr-Enabled Development Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision the development container with Herdr, OpenCode, the Herdr agent skill, the OpenCode integration, the Herdr Agent Quota plugin, optional Linux host notifications, and OpenCode session titles in the Herdr Agents pane.

**Architecture:** A Node 22 Dev Container with Docker-in-Docker runs one idempotent provisioning script after creation. The script installs user-scoped Herdr/OpenCode tooling, installs the quota plugin for OpenCode, and updates only the owned Herdr settings. The container optionally receives the host Linux session D-Bus socket so Herdr system notifications can reach the desktop; Herdr's OpenCode-specific sidebar layout uses the native `terminal_title_stripped` token.

**Tech Stack:** Dev Container JSON, `mcr.microsoft.com/devcontainers/typescript-node:22`, Docker-in-Docker feature, POSIX shell, Bash, Node/npm, Herdr CLI, OpenCode CLI, `npx skills`, Git, Rust/Cargo, shell test scripts.

**Spec:** `docs/superpowers/specs/2026-09-02-herdr-devcontainer-design.md`

## Global Constraints

- Use Node `>=22.22.3`.
- Install current stable Herdr and OpenCode releases through their official installers.
- Install the Herdr skill with `npx skills add herdrdev/herdr --skill herdr -g`.
- Install the quota plugin from `https://github.com/levi-qiao/herdr-agent-quota` and configure its OpenCode collector.
- Preserve unrelated Herdr settings, OpenCode plugins, and credentials.
- Treat host D-Bus forwarding as optional; missing D-Bus must not fail provisioning.
- Do not automatically launch the Herdr TUI from a Dev Container lifecycle hook.
- Leave the repository's existing `opencode.json` plugin configuration intact.
- Do not change production Compose, application business logic, or unrelated frontend code.

---

### Task 1: Add idempotent Herdr provisioning and configuration

**Files:**
- Create: `.devcontainer/setup-herdr.sh`
- Create: `.devcontainer/setup-herdr.test.sh`

**Interfaces:**
- Consumes: `HOME`, `PATH`, the optional `/tmp/host-dbus-bus` socket, and the external commands `curl`, `bash`, `npx`, `herdr`, `opencode`, `git`, and `cargo` through their normal CLI interfaces.
- Produces: an executable setup script that can be invoked as `bash .devcontainer/setup-herdr.sh`; Herdr installed on `PATH`; OpenCode installed on `PATH`; global `herdr` skill; OpenCode Herdr integration; linked `herdr-agent-quota` plugin; and Herdr config entries for notifications and OpenCode title display.

- [ ] **Step 1: Write the failing setup test harness**

Create a temporary fake home and fake `PATH`. Each stub must append its command line to `$CALL_LOG`, return a configurable status, and create the files that the next setup step expects. Cover these scenarios:

```sh
run_setup() {
  HOME="$WORK/home" PATH="$STUBS:$PATH" CALL_LOG="$WORK/calls" \
    HERDR_PLUGIN_SOURCE_DIR="$WORK/home/.local/src/herdr-agent-quota" \
    sh "$SCRIPT"
}

test_fresh_setup() {
  make_stubs
  run_setup
  assert_file "$WORK/home/.config/herdr/config.toml"
  assert_contains "$WORK/home/.config/herdr/config.toml" 'delivery = "system"'
  assert_contains "$WORK/home/.config/herdr/config.toml" 'terminal_title_stripped'
  assert_contains "$WORK/calls" 'skills add herdrdev/herdr --skill herdr -g'
  assert_contains "$WORK/calls" 'integration install opencode'
  assert_contains "$WORK/calls" 'install.sh --agent opencode'
}

test_rerun_is_idempotent() {
  make_stubs
  run_setup
  first_config=$(read_file "$WORK/home/.config/herdr/config.toml")
  run_setup
  second_config=$(read_file "$WORK/home/.config/herdr/config.toml")
  assert_equal "$first_config" "$second_config"
  assert_line_count "$WORK/calls" 'git clone' 1
}

test_unrelated_config_survives() {
  mkdir -p "$WORK/home/.config/herdr"
  printf '%s\n' '[theme]' 'name = "terminal"' >"$WORK/home/.config/herdr/config.toml"
  make_stubs
  run_setup
  assert_contains "$WORK/home/.config/herdr/config.toml" 'name = "terminal"'
}

test_missing_dbus_is_warning_only() {
  make_stubs
  output=$(run_setup 2>&1)
  assert_contains "$output" 'D-Bus'
  assert_status 0
}

test_required_install_failure_is_fatal() {
  make_stubs
  HERDR_INSTALL_RC=1
  if run_setup >/dev/null 2>&1; then fail 'setup unexpectedly succeeded'; fi
}
```

Use shell assertions implemented in the test file; do not use the real home, network, Herdr server, Git repository, Cargo, or OpenCode installation.

- [ ] **Step 2: Run the focused test to confirm it fails**

Run: `sh .devcontainer/setup-herdr.test.sh`

Expected: FAIL because `.devcontainer/setup-herdr.sh` does not exist and none of the setup outputs are generated.

- [ ] **Step 3: Implement command installation and plugin setup**

Implement `.devcontainer/setup-herdr.sh` with `set -eu` and these operations:

```sh
install_script() {
  url=$1 name=$2
  file=$(mktemp)
  trap 'rm -f "$file"' EXIT HUP INT TERM
  curl -fsSL "$url" -o "$file"
  bash "$file"
  rm -f "$file"
  trap - EXIT HUP INT TERM
  command -v "$name" >/dev/null 2>&1 || die "$name installer completed but $name is not on PATH"
}

command -v herdr >/dev/null 2>&1 || install_script https://herdr.dev/install.sh herdr
command -v opencode >/dev/null 2>&1 || install_script https://opencode.ai/install opencode

npx --yes skills add herdrdev/herdr --skill herdr -g

if ! herdr integration status 2>/dev/null | grep -q 'opencode'; then
  herdr integration install opencode
fi

plugin_dir=${HERDR_PLUGIN_SOURCE_DIR:-$HOME/.local/src/herdr-agent-quota}
if [ -d "$plugin_dir/.git" ]; then
  git -C "$plugin_dir" pull --ff-only
else
  mkdir -p "$(dirname "$plugin_dir")"
  git clone https://github.com/levi-qiao/herdr-agent-quota "$plugin_dir"
fi
(
  cd "$plugin_dir"
  ./install.sh --agent opencode
)
```

Prepend `$HOME/.local/bin` to `PATH` before checking installers, because the official Linux installers may place binaries there. Keep failures from required installs fatal and print the failing command's purpose.

- [ ] **Step 4: Implement safe Herdr config updates**

Create `$HOME/.config/herdr/config.toml` if absent. Add a line-aware update routine that:

1. Finds or creates the `[ui.toast]` table and updates only `delivery` to `"system"`.
2. Finds or creates `[ui.sidebar.agents.rows_by_agent]` and updates only the `opencode` entry to:

```toml
opencode = [["state_icon", "agent"], ["terminal_title_stripped"]]
```

3. Preserves every unrelated line, section, agent override, and existing comment.
4. Removes and recreates only a clearly marked managed line/block on rerun, so it never duplicates settings.

Handle an existing inline `rows_by_agent = { ... }` value by converting it to the table form while retaining all existing entries, then replacing only the `opencode` entry. The tests must include an existing non-OpenCode agent override in this table.

Check `-S /tmp/host-dbus-bus` before claiming host notifications are enabled. Always write the Herdr `system` delivery setting, but print a warning when the socket is unavailable so Herdr remains usable and the user knows why desktop delivery may not work.

- [ ] **Step 5: Run the focused test to confirm it passes**

Run: `sh .devcontainer/setup-herdr.test.sh`

Expected: all fresh, rerun, preservation, D-Bus, and failure-path checks PASS.

- [ ] **Step 6: Commit the provisioning unit**

```bash
git add .devcontainer/setup-herdr.sh .devcontainer/setup-herdr.test.sh
git commit -m "feat: provision Herdr and OpenCode tooling"
```

### Task 2: Define the Dev Container and D-Bus/port integration

**Files:**
- Create: `.devcontainer/devcontainer.json`
- Modify: `infra/scripts/devcontainer-up.sh`
- Modify: `infra/scripts/devcontainer-up.test.sh`

**Interfaces:**
- Consumes: `.devcontainer/setup-herdr.sh`, the existing `make dev-setup` workflow, and the Linux host session bus.
- Produces: a Dev Container definition based on Node 22 with Docker-in-Docker, D-Bus forwarding, and post-create Herdr provisioning; host bootstrap behavior that does not assume fixed worktree ports.

- [ ] **Step 1: Add failing JSON/bootstrap assertions**

Extend `infra/scripts/devcontainer-up.test.sh` to assert that the checked-in Dev Container definition contains:

```text
mcr.microsoft.com/devcontainers/typescript-node:22
ghcr.io/devcontainers/features/docker-in-docker:2
postCreateCommand
/tmp/host-dbus-bus
setup-herdr.sh
```

Add a test that makes the fake `devcontainer up` report a dynamically allocated URL or no fixed port, then verifies the host helper does not hard-code `3000` and `8080` as the only readiness ports.

Run: `sh infra/scripts/devcontainer-up.test.sh`

Expected: FAIL until the Dev Container definition and bootstrap logic are updated.

- [ ] **Step 2: Create `.devcontainer/devcontainer.json`**

Use this shape, retaining the existing Docker-in-Docker design:

```json
{
  "name": "BGGG Development",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22",
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  },
  "remoteUser": "node",
  "mounts": [
    "source=/run/user/${localEnv:HOST_UID}/bus,target=/tmp/host-dbus-bus,type=bind,consistency=cached"
  ],
  "containerEnv": {
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/host-dbus-bus"
  },
  "forwardPorts": [3000, 3001, 8080, 5432, 8200],
  "portsAttributes": {
    "3000": { "label": "web", "onAutoForward": "notify" },
    "3001": { "label": "api", "onAutoForward": "notify" },
    "8080": { "label": "keycloak", "onAutoForward": "silent" },
    "5432": { "label": "postgres", "onAutoForward": "silent" },
    "8200": { "label": "vault", "onAutoForward": "silent" }
  },
  "postCreateCommand": "bash .devcontainer/setup-herdr.sh"
}
```

The host bootstrap script must export `HOST_UID=$(id -u)` before invoking the Dev Container CLI. Document that VS Code launches should set `HOST_UID` in the environment when the D-Bus mount is desired; a missing `/run/user/$HOST_UID/bus` source is tolerated by setup and disables only desktop delivery.

- [ ] **Step 3: Make host bootstrap port-aware**

Update `infra/scripts/devcontainer-up.sh` so it:

1. Exports the numeric host UID before `devcontainer up`.
2. Keeps `--no-setup` and `--no-shell` behavior unchanged.
3. Reads the worktree’s generated `.env` through `devcontainer exec` or `make dev-status` before probing, rather than assuming only ports 3000 and 8080.
4. Falls back to the declared default ports when no `.env` exists or `--no-setup` was selected.
5. Prints the actual web and Keycloak URLs in its ready message.

Do not alter the in-container worktree port allocation logic.

- [ ] **Step 4: Run Dev Container tests and syntax checks**

Run:

```sh
sh -n .devcontainer/setup-herdr.sh
sh -n infra/scripts/devcontainer-up.sh
node -e 'JSON.parse(require("fs").readFileSync(".devcontainer/devcontainer.json", "utf8"))'
sh .devcontainer/setup-herdr.test.sh
sh infra/scripts/devcontainer-up.test.sh
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the Dev Container unit**

```bash
git add .devcontainer/devcontainer.json infra/scripts/devcontainer-up.sh infra/scripts/devcontainer-up.test.sh
git commit -m "feat: define Herdr-enabled devcontainer"
```

### Task 3: Document operation and run the complete verification suite

**Files:**
- Create: `docs/reference/herdr-devcontainer.md`
- Modify: `Makefile.test.sh` only if the repository’s test dispatcher requires registration of the new test.

**Interfaces:**
- Consumes: the installed commands and config paths from Tasks 1 and 2.
- Produces: user-facing instructions for container and host Herdr modes, notification prerequisites, repair, and validation; a verified repository change.

- [ ] **Step 1: Write documentation acceptance checks**

Before writing documentation, add checks to the test dispatcher if necessary so the following required strings are verified in the documentation:

```text
make devcontainer-up
herdr
herdr integration status
herdr plugin list
npx skills ls -g
HOST_UID
/tmp/host-dbus-bus
terminal_title_stripped
```

If `Makefile.test.sh` does not dispatch shell tests automatically, leave it unchanged and run the new test explicitly in the verification command list.

- [ ] **Step 2: Write the user documentation**

Document these exact workflows:

```sh
export HOST_UID="$(id -u)"
infra/scripts/devcontainer-up.sh
```

Inside the container:

```sh
herdr
herdr integration status
herdr plugin list
npx skills ls -g
```

Explain that:

- the container setup installs the latest stable Herdr/OpenCode tooling;
- `herdr` is intentionally not auto-launched;
- the quota plugin is configured for OpenCode and requires the relevant provider credentials in the same container user account;
- the host D-Bus socket is optional and session-scoped;
- `system` notification delivery needs `/tmp/host-dbus-bus` to be a socket;
- host-side Herdr can be used instead, but it cannot observe container processes as if they were host processes;
- rerun `bash .devcontainer/setup-herdr.sh` to repair/update the setup;
- OpenCode titles appear on the second line of its Herdr Agents-pane entry after an OpenCode session has generated a title.

- [ ] **Step 3: Run all repository shell tests**

Run:

```sh
sh .devcontainer/setup-herdr.test.sh
sh infra/scripts/devcontainer-up.test.sh
sh scripts/dev-servers.test.sh
sh scripts/sync-dev-secrets.test.sh
sh scripts/worktree-dev.test.sh
sh scripts/worktrees-dev.test.sh
sh infra/keycloak/seed-dev-user.test.sh
sh infra/ansible/deploy.test.sh
sh Makefile.test.sh
```

Expected: every test reports success and exits 0.

- [ ] **Step 4: Run an external-tool smoke test when available**

If `docker` and `devcontainer` are available, run:

```sh
devcontainer up --workspace-folder "$PWD"
devcontainer exec --workspace-folder "$PWD" bash -lc 'command -v herdr && command -v opencode && herdr integration status && herdr plugin list && npx skills ls -g'
```

Then verify the Herdr config and mounted socket:

```sh
devcontainer exec --workspace-folder "$PWD" bash -lc 'test -f "$HOME/.config/herdr/config.toml" && grep -F terminal_title_stripped "$HOME/.config/herdr/config.toml"'
devcontainer exec --workspace-folder "$PWD" bash -lc 'test ! -e /tmp/host-dbus-bus || test -S /tmp/host-dbus-bus'
```

If the external tools are unavailable, report that limitation without claiming the smoke test passed.

- [ ] **Step 5: Review the final diff and commit documentation**

Run:

```sh
git diff --check
git status --short
git diff --stat
git log --oneline -10
```

Confirm that only the intended Dev Container, setup, bootstrap test, documentation, and optional test-dispatch files changed. Then commit:

```bash
git add .devcontainer docs/reference/herdr-devcontainer.md infra/scripts/devcontainer-up.sh infra/scripts/devcontainer-up.test.sh Makefile.test.sh
git commit -m "docs: document Herdr development workflow"
```

## Plan Self-Review

- Spec coverage: Tasks 1 and 2 cover all provisioning, integration, quota, title, D-Bus, idempotency, and host-mode requirements; Task 3 covers documentation and full verification.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step is required.
- Interface consistency: Task 1 produces `.devcontainer/setup-herdr.sh`; Task 2 invokes it through `postCreateCommand`; Task 3 documents and smoke-tests the commands installed by Task 1.
- Scope: the repository `opencode.json`, production Compose files, and application code remain untouched.
