# DuckDNS — Self-Updating Dynamic DNS (replacing Cloudflare's DNS record)

**Phase:** 4 — Cloud Infrastructure & Hardening (detour, revising `4_terraform`)
**Topic ID:** `4_duckdns`
**Date:** 2026-07-19
**SecOps:** Yes

---

## What Is This?

DuckDNS is a free dynamic DNS service: it gives you a subdomain
(`yourname.duckdns.org`) and one HTTP endpoint you call to say "point my
subdomain at this IP right now." There's no zone to manage, no nameservers
to configure — just a GET request with a token proving the call is really
you. "Dynamic" is the key word: unlike a normal DNS record you set once and
forget, DuckDNS is designed to be called over and over, specifically for
servers whose IP might change without warning (a home internet connection
after a router reboot, or — the case here — a cloud free-tier VM's
ephemeral public IP).

---

## Why Does It Matter for This Project?

`infra/terraform/cloudflare.tf`'s `cloudflare_record.app` (see
`notes/4_terraform.md`) required owning a real domain and a Cloudflare
account/zone for it. Going "completely free" means removing that
dependency — DuckDNS's subdomain and update API cost nothing and need
nothing but an email/GitHub login to register. The `cloudflare_r2_bucket`
stays untouched (R2 has its own always-free tier and has nothing to do with
DNS); only the DNS half of `cloudflare.tf` is being replaced.

---

## The Decision

Chose: an Ansible-managed **systemd timer** on the VM itself, running a
small script that calls DuckDNS's update URL every few minutes.

Because: this was worked out in the prior discussion — Terraform's model is
"create a resource once, track it in state, change it only when you run
`apply`." DuckDNS's whole point is the opposite: the IP can drift out from
under you (VM reboot, instance recreation) *without* anyone running
Terraform, and a stale DNS record would just sit there wrong until someone
noticed. A timer running on the VM itself keeps checking in on its own
schedule, independent of whether you ever touch Terraform or Ansible again.
This also matches the tool boundary `notes/4_ansible.md` already
established: Terraform answers "what infrastructure exists," Ansible
answers "what's configured/running on it" — a background job that keeps a
service correct over time is squarely Ansible's job, not Terraform's.

Alternative: a Terraform `null_resource` with a `local-exec` provisioner,
triggered whenever `oci_core_instance.app_server.public_ip` changes.
Drawback: only fires when *you* run `terraform apply` from your own
machine. If the IP changes for any reason without that (instance reboot
assigning a new ephemeral IP, someone else applying from a different
machine), DNS silently goes stale until the next manual apply — the exact
failure mode DuckDNS exists to prevent.

Alternative: a plain cron job instead of a systemd timer. Drawback: works,
but loses the observability the `docker` role's `service` module already
gives every other managed process on this VM (`systemctl status`,
`journalctl -u`) — a timer/service pair is the more consistent choice given
everything else on this box is already managed as a systemd unit.

---

## Worked Example

This is **not** the DuckDNS script — it isolates just the mechanic
("Ansible templates a script + wires up a systemd timer to run it
periodically") using a trivial heartbeat script instead, so the DuckDNS-
specific curl syntax doesn't get in the way of seeing how the pieces fit.

### Scenario

You want a file on a server that gets a fresh timestamp appended to it
every 30 seconds, forever, starting shortly after the timer is first
enabled — without a human ever running the script by hand.

### Code / Configuration

`roles/heartbeat/templates/heartbeat.sh.j2`:
```bash
#!/bin/sh
# {{ ansible_managed }} — a Jinja2 template, not a plain file: Ansible
# renders {{ }} expressions before writing this to the remote host.
echo "$(date -Iseconds) heartbeat from {{ inventory_hostname }}" >> {{ heartbeat_log_path }}
```

`roles/heartbeat/tasks/main.yml`:
```yaml
---
- name: Render the heartbeat script
  template:
    src: heartbeat.sh.j2
    dest: /opt/heartbeat.sh
    mode: "0755"

- name: Install the systemd service (what to run)
  copy:
    dest: /etc/systemd/system/heartbeat.service
    content: |
      [Unit]
      Description=Heartbeat script
      [Service]
      Type=oneshot
      ExecStart=/opt/heartbeat.sh

- name: Install the systemd timer (when to run it)
  copy:
    dest: /etc/systemd/system/heartbeat.timer
    content: |
      [Unit]
      Description=Run heartbeat.service on a schedule
      [Timer]
      # First run ~30s after the timer is (re)started — not tied to boot
      # time, so 'ansible-playbook' converging this role has an
      # observable effect immediately, not "whenever the box next reboots."
      OnActiveSec=30s
      # Every run after that, 5 minutes after the *previous* run finished.
      OnUnitActiveSec=5min
      [Install]
      WantedBy=timers.target

- name: Reload systemd so it notices the new unit files
  systemd:
    daemon_reload: true

- name: Enable and start the timer (NOT the .service directly)
  systemd:
    name: heartbeat.timer
    enabled: true
    state: started
```

### What Is Happening Step by Step

1. **`template` vs `copy`** — the script itself uses `template` because it
   has a `{{ }}` placeholder Ansible must fill in per-host
   (`inventory_hostname`); the systemd unit files use plain `copy` because
   their content is fixed text, no per-host substitution needed.
2. **Two separate units, not one.** `heartbeat.service` defines *what* runs
   (`Type=oneshot` means "run once and exit," not "keep running like a
   server"); `heartbeat.timer` defines *when* — this split is systemd's
   design, and it's why you enable/start the `.timer`, never the
   `.service` directly, for anything meant to repeat.
3. **`daemon_reload` is not optional.** Dropping new unit files into
   `/etc/systemd/system/` doesn't make systemd notice them — it only reads
   that directory at boot or when told to re-scan it. Skip this task and
   the next task (`enabled: true, state: started` on a timer systemd has
   never heard of) fails outright.
4. **`OnActiveSec` vs `OnUnitActiveSec`.** The first is relative to *this
   timer being started* (guarantees a near-immediate first run, useful for
   confirming the whole chain works right after `ansible-playbook` finishes);
   the second is relative to *the last time this timer fired* (the actual
   steady-state repeat interval). Using only `OnUnitActiveSec` would still
   work, but the very first run wouldn't happen until 5 minutes after the
   timer started — annoying when you're trying to verify it worked.
5. **Idempotency still applies.** Re-running this role with no changes:
   `copy`/`template` report "ok" (checksums match, nothing rewritten), and
   the `systemd` tasks report "ok" (timer is already enabled and already
   running) — nothing restarts, no duplicate timer fires.

### What Would Break If You Changed X?

If `OnActiveSec` and `OnUnitActiveSec` were both removed from the
`[Timer]` section, the timer unit would still install and "start"
successfully (no error), but it would never actually fire the service —
`systemctl list-timers` would show it with no `NEXT` value, because a
timer with no trigger conditions has nothing telling it when to run. This
is a quiet failure mode: everything reports success, but the heartbeat
file simply never gets written, which is exactly the kind of bug that's
easy to miss without checking `systemctl list-timers` or the journal.

---

## Now Apply It

The real DuckDNS role follows this identical shape, with two differences
the worked example deliberately left out: the script is a `curl` call
carrying a **secret token** (not a harmless timestamp), and that token
must never be committed to the repo or shown in Ansible's own logs.

- `infra/ansible/roles/duckdns/templates/duck.sh.j2` — same idea as
  `heartbeat.sh.j2`, rendering `{{ duckdns_domain }}` and
  `{{ duckdns_token }}` into a `curl` call against
  `https://www.duckdns.org/update`.
- `infra/ansible/roles/duckdns/tasks/main.yml` — same
  template → systemd service → systemd timer → `daemon_reload` → enable
  shape as the worked example, plus `mode: "0700"` on the rendered script
  (only root can even read the file containing the token) and
  `no_log: true` on the templating task (so the token never appears in
  `ansible-playbook`'s own console output or logs).
- `infra/ansible/roles/duckdns/defaults/main.yml` — `duckdns_domain`
  (non-secret, has a sensible default). `duckdns_token` deliberately has
  **no default** here — it's passed at run time
  (`-e duckdns_token=$DUCKDNS_TOKEN`), the same "lives in the operator's
  shell, never in a committed file" pattern
  `generate_inventory.sh` already uses for `SSH_KEY_PATH`.
- `infra/ansible/playbook.yml` — the `duckdns` role added to the
  `roles:` list.
- `infra/terraform/cloudflare.tf` — `cloudflare_record.app` deleted
  entirely; `cloudflare_r2_bucket.uploads` untouched.
- `infra/terraform/variables.tf` / `outputs.tf` — `domain_name` and
  `cloudflare_zone_id` removed (nothing in Terraform needs the domain
  anymore); `app_domain` output either removed or reworked to just
  interpolate `"${var.duckdns_domain}.duckdns.org"` as a plain string
  (no live resource backs it — it's informational only).
- `.env.example` — `DOMAIN_NAME`'s comment updated to point at the
  DuckDNS domain instead of "must match `infra/terraform`'s `domain_name`
  variable."

Files to look at after this note (once generated):
- `infra/ansible/roles/duckdns/` — the three files above
- `infra/ansible/playbook.yml` — where `duckdns` is added
- `infra/terraform/cloudflare.tf` — the DNS record removed, R2 bucket intact

---

## SecOps Notes

**Security property upheld:** secret handling for a static, long-lived
credential that (unlike `DB_PASSWORD`) can't be freshly generated on every
deploy — DuckDNS assigns you one token when you register, and it stays
valid until you manually reset it on their site. That makes it closer to
`cloudflare_api_token` (a bearer credential you must protect) than to the
bootstrap DB password's generate-and-discard pattern.

**What it mitigates:** anyone holding this token can repoint
`<subdomain>.duckdns.org` at an IP of their choosing — a real risk (traffic
meant for your VM, including anything relying on that hostname for TLS
certificate validation, could be redirected). `no_log: true` keeps it out
of Ansible's console/log output; `mode: "0700"` on the rendered script
keeps it unreadable to any non-root user who gets a shell on the VM;
passing it as a run-time extra-var (never a committed default) keeps it
out of git history entirely.

**What would go wrong if skipped:** if the token were instead hardcoded
into `defaults/main.yml` (committed to git), it would be permanently
recoverable from git history even after being "removed" in a later commit
— the exact mistake `notes/3_vault.md` already flagged for `.env` and
`DB_PASSWORD`, just for a different secret.

**No NSG change needed:** this only adds an *outbound* HTTPS call from the
VM to `www.duckdns.org`. `infra/terraform/nsg.tf`'s egress rule is already
`all_egress` (0.0.0.0/0, all protocols) — outbound was never restricted, so
nothing in Terraform needs to change to allow this.

---

## Checkpoint Questions

1. Why does a systemd **timer** exist as a separate unit from the
   **service** it triggers, instead of just putting a sleep loop inside
   the service itself?
2. What's the concrete difference between `OnActiveSec` and
   `OnUnitActiveSec`, and why does the DuckDNS role want both instead of
   just the second one?
3. Why can't the DuckDNS token be regenerated fresh on every Ansible run
   the way `bootstrap_db_password` is in `app_deploy`'s tasks — what's
   actually different about the two secrets?
4. If someone forgot `daemon_reload` after adding the new unit files, what
   would actually happen when the next task tries to enable
   `duckdns.timer` — a clear error, or something quieter?
5. Why does removing `cloudflare_record.app` not require touching
   `cloudflare_r2_bucket.uploads` or the `cloudflare` provider block at
   all?

---

## Rewrite Exercise

Delete `infra/ansible/roles/duckdns/` after this session and recreate it
from memory (the worked example above may stay open for systemd syntax,
but not the generated DuckDNS files themselves).

Focus on: getting the **timer vs. service** split right (which unit you
enable/start, which one just gets triggered), and correctly keeping
`duckdns_token` out of any file that would get committed — that's the
part most likely to be gotten wrong under "let's just make it work"
pressure.

---

## Summary

*(filled in after the checkpoint)*
