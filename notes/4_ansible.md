# Ansible — Playbooks, Roles, Inventory, Idempotent Config Management

**Phase:** 4 — Cloud Infrastructure & Hardening
**Topic ID:** `4_ansible`
**Date:** 2026-07-16
**SecOps:** No

---

## What Is This?

Terraform's job (just finished, `notes/4_terraform.md`) was to create the
*resource* — the VM itself, the network, the DNS record. Ansible's job
starts the moment that VM exists: it connects over SSH and configures
*what's running inside it* — installing Docker, copying config files,
starting `docker compose up`, applying kernel/SSH hardening. Where
Terraform describes infrastructure, Ansible describes state: "this file
should exist with this content," "this package should be installed," "this
service should be running." You describe the end state you want; Ansible
figures out what commands get you there and — critically — does nothing if
you're already in that state.

---

## Why Does It Matter for This Project?

`main.tf` already leaves a direct trail for this: the VM's
`ssh_authorized_keys` metadata block says outright "Ansible (next topic)
connects with this key, never a password," and `outputs.tf`'s
`app_server_public_ip` output exists specifically so "Ansible's inventory
file reads this instead of a hardcoded address." Terraform hands you a bare
Ubuntu 22.04 ARM VM with SSH access and nothing else — no Docker, no
`docker-compose.yml` copied over, none of the `infra/keycloak/` or
`infra/vault/` files this project already has sitting in git. Ansible is
what takes those two things (a reachable VM, a repo full of config files)
and actually gets the app running on that VM, repeatably, every time you
provision a fresh instance or need to reapply config after a change.

---

## The Decision

Chose: Ansible with a single inventory sourced from Terraform's output,
one playbook, and roles split by concern (`docker`, `app_deploy`,
`hardening`).

Because: Splitting into roles means each piece of server configuration is
independently testable and reusable — the `hardening` role (SSH config,
later Fail2ban) doesn't need to know anything about Docker, and the
`app_deploy` role doesn't need to know anything about SSH. It also mirrors
how `references/secops.md`'s layers are described as separate concerns
(NSG, Traefik, Fail2ban) — Ansible roles give each of those a home.

Alternative: One long, flat playbook with all tasks inline, no roles.

Drawback of alternative: Works fine at this project's current size, but
every task list becomes harder to read as more hardening steps are added
in later topics (`4_fail2ban`, `4_container_security`), and there's no way
to reuse, say, just the Docker install step without also running
everything else in the file.

---

## Worked Example

This example is NOT the board game platform's playbook. It's a minimal
setup that provisions Docker onto a single server and starts one
container, so you can see inventory → playbook → role end to end.

### Scenario

You have one server, reachable by IP over SSH with a private key. You want
to run `ansible-playbook` and have it: install Docker if it's missing, copy
over an nginx config, and make sure an nginx container is running — safely
re-runnable if you do it again tomorrow.

### Code / Configuration

`inventory.ini`:
```ini
# Group name '[web]' — referenced in the playbook's 'hosts:' field.
# In the real project this IP would be templated from Terraform's
# app_server_public_ip output rather than typed by hand.
[web]
203.0.113.10 ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/bggg_key
```

`playbook.yml`:
```yaml
---
- name: Configure web server
  # Matches the [web] group in inventory.ini — this play runs against
  # every host in that group, one server or a hundred, no change needed.
  hosts: web
  # Most modules need root to install packages or write to /etc — this
  # elevates privilege for every task in the play via sudo.
  become: true

  roles:
    # Roles run top to bottom. Docker must exist before the nginx
    # container role tries to start a container.
    - docker
    - nginx_container
```

`roles/docker/tasks/main.yml`:
```yaml
---
- name: Install Docker's dependencies
  apt:
    name:
      - ca-certificates
      - curl
    state: present
    update_cache: true

- name: Add Docker's official GPG key
  apt_key:
    url: https://download.docker.com/linux/ubuntu/gpg
    state: present

- name: Install Docker Engine
  apt:
    name: docker-ce
    state: present

- name: Ensure Docker is running and enabled at boot
  service:
    name: docker
    state: started
    enabled: true
```

`roles/nginx_container/tasks/main.yml`:
```yaml
---
- name: Copy nginx config to the server
  # 'copy' checksums the source and destination first — if the file
  # already matches, this task reports "ok" (no change) instead of
  # re-copying. This is idempotency in action.
  copy:
    src: nginx.conf
    dest: /opt/nginx.conf

- name: Run nginx container
  docker_container:
    name: nginx
    image: nginx:1.27-alpine
    state: started
    # If you re-run the playbook and the container is already running
    # with this exact config, Ansible detects no change is needed and
    # does nothing — it does NOT stop and restart the container every
    # single run, which is what makes this safe to run repeatedly.
    restart_policy: unless-stopped
    ports:
      - "80:80"
    volumes:
      - /opt/nginx.conf:/etc/nginx/nginx.conf:ro
```

### What Is Happening Step by Step

1. **You run `ansible-playbook -i inventory.ini playbook.yml`.** Ansible
   reads the inventory, finds one host in the `web` group, and connects to
   it over SSH using the specified key — no agent or daemon needs to be
   pre-installed on the target server for this to work.

2. **The play's `become: true` means every task runs as root** on the
   remote host via `sudo`, without you needing to SSH in and type `sudo`
   yourself for each command.

3. **The `docker` role runs first.** Each task is declarative — "docker-ce
   should be `state: present`" — not "run `apt install docker-ce`". Ansible
   checks the current state first (is it already installed?) and only acts
   if it isn't. Run the playbook twice in a row and the second run reports
   everything as "ok" (unchanged), nothing as "changed."

4. **The `nginx_container` role runs second**, after Docker exists. The
   `copy` task compares file checksums, not just "does the destination
   exist" — if you edit `nginx.conf` locally and re-run, only the changed
   file actually gets copied.

5. **`docker_container` ensures the nginx container is running with this
   exact configuration.** If you change the image tag or a mounted file and
   re-run, Ansible recreates just that container. If nothing changed,
   nothing happens — this is the same idempotency principle as the `copy`
   task, applied to a running container instead of a file.

### What Would Break If You Changed X?

If you removed `become: true`, every task requiring root (installing
packages, writing to `/opt`, managing the Docker service) would fail with a
permission error the moment it tried to write somewhere the SSH user
(`ubuntu`) doesn't own — Ansible would report a clear "Permission denied"
rather than silently doing nothing, but the whole play would stop at the
first such task.

If `roles:` listed `nginx_container` before `docker`, the very first task
of `nginx_container` (or more precisely, the `docker_container` task within
it) would fail because the `docker` Python module / CLI wouldn't exist on
the host yet — order matters exactly like a dependency graph, the same
concept as `depends_on` in `docker-compose.dev.yml`.

---

## Now Apply It

In this project, Ansible is the bridge between what Terraform just
provisioned and an actually-running app. Terraform's `app_server_public_ip`
output feeds the inventory; the VM's `ssh_authorized_keys` (set from
`var.ssh_public_key` in `main.tf`) is exactly the connection Ansible uses —
no password auth exists to fall back on, matching the SSH hardening
direction this project is already heading (see `ssh_allowed_cidr`'s comment
about Fail2ban being "the backstop").

The roles this project will need, roughly in dependency order: a `docker`
role (Docker Engine + Compose plugin), an `app_deploy` role (clone/rsync
the repo, copy `docker-compose.yml`, run `docker compose up -d`), and later
a `hardening` role that `4_fail2ban` will extend (`sshd_config`,
`PasswordAuthentication no`, `PermitRootLogin no` — directly from
`references/secops.md`'s Network Hardening checklist).

Files to look at / create after this note:
- `infra/ansible/inventory.ini` (or a dynamic inventory script) — should
  read `terraform output app_server_public_ip` rather than a hardcoded IP,
  the same way `outputs.tf`'s comment anticipates.
- `infra/ansible/playbook.yml` and `infra/ansible/roles/` — new directory,
  following the `docker` / `nginx_container`-style split above but for
  `docker`, `app_deploy`, and (later) `hardening`.
- `docker-compose.yml` — this is the file the `app_deploy` role will
  actually copy onto the server and run.

---

## Checkpoint Questions

1. In your own words, what's the difference in *what problem is being
   solved* between Terraform and Ansible? Why can't one tool just do both?
2. If you ran the worked example's playbook twice in a row, what output
   would you expect the second time, and why?
3. Why does the `docker` role have to be listed before `nginx_container` in
   the playbook's `roles:` list — what would the actual error message look
   like if you got the order wrong?
4. The VM's `ssh_authorized_keys` metadata is set by Terraform, not
   Ansible. Why does Ansible still need that key, and what happens if the
   private key on your machine doesn't match the public key Terraform
   injected?
5. What does "idempotent" mean here, concretely — pick one task from the
   worked example (not a definition) and explain what makes it safe to
   re-run.

---

## Rewrite Exercise

Delete the roles directory and playbook you generate for this project and
recreate them from memory (you may keep the worked example above open as a
reference for syntax, but not any project-specific file you write in this
session).

Focus on: getting the role ordering right (`docker` before `app_deploy`
before `hardening`) and correctly wiring the inventory to Terraform's
`app_server_public_ip` output rather than hardcoding an IP — that
IP-hardcoding shortcut is the most tempting thing to do wrong here, and the
one most likely to break the moment the VM is ever recreated.

---

## Summary

**Built:** `infra/ansible/generate_inventory.sh` (reads the VM's IP from
`terraform output -raw`, never from `terraform.tfstate` directly); a
`docker` role that derives both CPU architecture and OS distribution from
Ansible's own gathered facts rather than hardcoding either; an `app_deploy`
role that clones the repo, generates a fresh bootstrap DB password on
every run via the `password` lookup's `/dev/null` cache-bypass trick
(never persisted to disk), and runs `docker compose up -d --build` with
that password scoped to just that one command's environment; and
`infra/ansible/playbook.yml` tying `docker` + `app_deploy` together.
Getting here also required a real detour: `apps/api` and `apps/web` had no
Dockerfiles yet, so those were built and verified (multi-stage, workspace-
aware, non-root, `standalone` output for web), `docker-compose.yml` gained
`api`/`web` service definitions, and `infra/vault/bootstrap.sh` gained its
own idempotency guard — the actual safety net behind the Vault "Approach
B" decision (generate-at-deploy-time, no secret ever committed even
encrypted).

**Verified, not just written:** both Dockerfiles were built and run for
real (API confirmed booting fully against a live throwaway Postgres
container using `DB_PASSWORD_FILE`; web confirmed serving a real HTTP 200
with working static assets). `ansible-core` was installed into this
sandbox and the actual playbook was run against it (`--check` then for
real, with `deploy_dir` overridden to keep it out of `/opt`) — that run
caught two genuine bugs (the `docker` role's apt repo URL was hardcoded to
`ubuntu`; this sandbox is Debian) before this note was written, not after.

**Demonstrated understanding of:** why `terraform output` (not
`terraform.tfstate`) is the right interface for the inventory script,
correctly citing it as a versioned CLI contract versus an internal,
version-dependent file format; solid idempotency reasoning for the
`docker` role's re-run behavior, including the useful `state: present`
vs. `state: latest` distinction once it was raised; and real engagement
with the Ansible Vault vs. HashiCorp Vault question — correctly identified
they're not the same tool after an initial ambiguous framing, and reasoned
through *why* both still matter (a bootstrap/transport secret vs. a live
runtime secret service), which led directly to preferring the
generate-at-deploy-time approach over a committed encrypted file.

**To revisit:**
- The `hardening` role (SSH config, `PasswordAuthentication no`) is
  intentionally deferred to `4_fail2ban`, per the roadmap's own dependency
  ordering — not a gap in this topic, just not this topic's job.
- This role has never actually run against the real Terraform-provisioned
  VM, only against this local sandbox (which caught real bugs but is a
  different OS than the actual target) — first real deploy will be the
  true test.
- `docker-compose.yml`'s `keycloak` and `vault` services still have zero
  production runtime config — all of it currently lives in
  `docker-compose.dev.yml`'s dev-mode flags (`start-dev`, dev-mode Vault).
  Making those genuinely production-ready is real, separate work this
  topic deliberately did not take on.
- The Keycloak client secret (`KEYCLOAK_API_SERVICE_SECRET`) reaches the
  `api` service as a plain env var in `docker-compose.yml` with no
  production secret-delivery story yet — the same `_FILE` treatment given
  to `DB_PASSWORD` hasn't been extended to it.
