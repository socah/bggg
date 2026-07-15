# Terraform — OCI Resources, Networking, NSGs, Cloudflare DNS/R2, State Management

**Phase:** 4 — Cloud Infrastructure & Hardening
**Topic ID:** `4_terraform`
**Date:** 2026-07-14
**SecOps:** Yes

---

## What Is This?

Terraform is a tool for describing infrastructure — servers, networks,
firewall rules — as text files instead of clicking through a cloud
provider's web console. You write down what you *want to exist*
(declarative), and Terraform figures out what API calls are needed to make
reality match that description. It also keeps a record — the **state
file** — of what it created, so the next time you run it, it knows
whether to create, change, or leave things alone.

---

## Why Does It Matter for This Project?

The board game platform deploys to Oracle Cloud Free Tier. Without
Terraform, provisioning the VM, its network, and its firewall rules means
clicking through the OCI console by hand — not reproducible, not
version-controlled, and impossible to tear down and recreate identically if
the free-tier instance ever needs to be rebuilt. With Terraform, the entire
cloud footprint is a set of `.tf` files in the repo: reviewable in a PR,
diffable, and re-runnable from scratch on a new OCI account if needed.

---

## The Decision

Chose: Terraform, scoped **only** to cloud resource provisioning — the VM,
Virtual Cloud Network (VCN), subnet, and Network Security Group (NSG).

Because: this keeps a clean boundary. Terraform answers "what infrastructure
exists," Ansible (next topic) answers "how is that infrastructure
configured," and Docker Compose answers "what application runs on it."
Mixing these concerns (e.g. using Terraform's `remote-exec` provisioner to
install Docker) creates a tool that does everything poorly instead of three
tools that each do one thing well — and it's the exact reason `design.md`
explicitly says "Terraform should NOT manage application deployment."

Alternative: A shell script calling the `oci` CLI directly.

Drawback of alternative: No state tracking — the script has no memory of
what it already created, so re-running it either duplicates resources or
requires you to hand-write idempotency checks that Terraform already gives
you for free.

Alternative: Pulumi (infrastructure-as-code using real TypeScript instead of
HCL).

Drawback of alternative: You already have TypeScript everywhere else in
this project (NestJS, Next.js) — Pulumi would fit that skillset, but
Terraform's HCL is the far more common tool in the industry for this
specific job, has first-class OCI provider support, and its declarative
(non-Turing-complete) nature makes infrastructure diffs easier to reason
about than arbitrary imperative code.

### A second decision: does Terraform's scope include Cloudflare too?

Chose: Yes — a Cloudflare DNS `A` record (pointing at the OCI VM's public
IP) and the R2 bucket are both declared in Terraform, using the
`cloudflare/cloudflare` provider alongside the `oci` provider in the same
project.

Because: `design.md`'s own Terraform section lists "DNS records" as
in-scope, and the underlying reasoning is identical to the NSG case — a DNS
record is just another piece of "what infrastructure exists," and doing it
by hand in the Cloudflare dashboard has the same reproducibility problem
manual OCI console clicks have. Terraform routinely manages resources
across more than one provider in a single configuration — that's normal,
not a scope violation.

The R2 bucket is different in one important way: it holds real
user-uploaded data (play session photos), not just compute/network
scaffolding. So it's declared in Terraform for reproducibility (so a fresh
`terraform apply` from scratch recreates *everything*, not "everything
except one resource someone has to remember to click through a dashboard
for"), but with a `lifecycle { prevent_destroy = true }` guard — see the
worked example below for why.

Alternative: Leave the R2 bucket as a manually-created, unmanaged resource
outside Terraform (as `3_r2_uploads` implicitly assumed).

Drawback of alternative: The bucket becomes a piece of infrastructure that
exists only in a person's memory of "oh right, I clicked that once in the
dashboard" — it does not show up in `terraform plan`, is not documented
anywhere in the repo, and would be silently missing if you ever tried to
rebuild the whole environment from the Terraform config alone.

---

## Worked Example

This example does **not** touch Oracle Cloud at all — no account, no
credentials needed. It uses Terraform's `random` and `local` providers to
isolate the core mechanic (state, plan, apply, idempotency) from the noise
of real cloud authentication and networking. Once this clicks, the OCI
version is the same mechanic with different resource types.

### Scenario

You want a text file on disk containing a randomly generated ID, and you
want that ID to stay stable across repeated runs — it should only change if
you explicitly ask Terraform to replace it.

### Code / Configuration

`main.tf`:
```hcl
terraform {
  required_providers {
    random = { source = "hashicorp/random", version = "~> 3.6" }
    local  = { source = "hashicorp/local",  version = "~> 2.5" }
  }
}

# Generates a random value and — critically — REMEMBERS it in state.
# Without state, every "terraform apply" would generate a new one.
resource "random_id" "server_tag" {
  byte_length = 4
}

# Writes a file whose content depends on the random_id resource above.
# Terraform builds a dependency graph from this reference automatically —
# you never say "run random_id first," it infers the order.
resource "local_file" "server_tag_file" {
  filename = "${path.module}/server-tag.txt"
  content  = "server-${random_id.server_tag.hex}\n"

  # Stands in for the real project's R2 bucket: a resource that holds
  # something precious enough that "terraform destroy" should refuse to
  # remove it, even if it's later deleted from main.tf entirely.
  lifecycle {
    prevent_destroy = true
  }
}

# Outputs print a value after apply — useful for feeding into another
# tool (in the real project: Ansible reads the VM's public IP this way).
output "tag" {
  value = random_id.server_tag.hex
}
```

### What Is Happening Step by Step

1. **`terraform init`** downloads the `random` and `local` provider plugins
   declared in the `required_providers` block and creates a
   `.terraform.lock.hcl` file pinning their exact versions.

2. **`terraform plan`** reads `main.tf`, compares it against the current
   state file (`terraform.tfstate` — which doesn't exist yet on first run),
   and prints what it *would* do: "create `random_id.server_tag`, create
   `local_file.server_tag_file`." Nothing happens to real infrastructure
   yet — this is a dry run.

3. **`terraform apply`** actually creates the resources: generates the
   random hex value, writes `server-tag.txt`, and — this is the important
   part — **saves both the random value and the fact that this file exists**
   into `terraform.tfstate`.

4. **Run `terraform apply` again with no changes to `main.tf`.** Terraform
   reads state, sees `random_id.server_tag` already has a stored value and
   `local_file.server_tag_file`'s content still matches what's on disk, and
   reports "no changes." This is idempotency — the whole point of
   declarative infrastructure. Compare this to a shell script that would
   happily regenerate a new random value and overwrite the file every time
   you ran it.

5. **Delete `server-tag.txt` by hand, then run `terraform plan`.**
   Terraform detects drift — state says the file should exist, disk says it
   doesn't — and plans to recreate it, using the *same* random value from
   state (not a new one), because `random_id.server_tag` itself is
   untouched.

6. **Run `terraform destroy` (or delete the `local_file` block from
   `main.tf` and run `apply`).** Terraform refuses, with an error naming
   `local_file.server_tag_file` and the `prevent_destroy` lifecycle rule.
   You would have to deliberately remove the `lifecycle` block first, in
   its own commit, before the resource can be destroyed — a guard against
   the "oops, I fat-fingered a `destroy` and it took the R2 bucket with it"
   scenario.

### What Would Break If You Changed X?

If you deleted `terraform.tfstate` (instead of just the file it manages)
and ran `apply` again, Terraform has no memory that `random_id.server_tag`
ever existed. It would generate a **new** random value and create a new
file — with no error, because from Terraform's point of view this is the
first time it's ever run. This is why, for the real project, the state file
(or a remote backend) is treated as precious: losing it doesn't just lose
a record, it makes Terraform blind to what's already running, risking
duplicate cloud resources on the next apply.

---

## Now Apply It

The real `4_terraform` code for this project swaps `random`/`local` for the
`oci` provider and models:

- An OCI **Compute Instance** (the free-tier VM) — same idea as
  `local_file` above: a resource block, created once, tracked in state.
- A **VCN** (Virtual Cloud Network) and **subnet** — the private network
  the VM lives in.
- A **Network Security Group (NSG)** with ingress rules for only ports 80,
  443, and SSH — this is the piece `references/secops.md`'s Network
  Hardening section calls "the outermost firewall."
- An `output` block exposing the VM's public IP — Ansible's inventory file
  (next topic) reads this value instead of you copy-pasting an IP by hand.
- A Cloudflare **DNS `A` record** — same "another resource block" pattern,
  just a second provider (`cloudflare` alongside `oci`) in the same
  configuration, pointing the project's domain at the OCI VM's public IP
  output above.
- A Cloudflare **R2 bucket** — modeled the same way as the `local_file`
  example's `prevent_destroy` guard, since it holds real uploaded photos,
  not just scaffolding that's cheap to recreate.

Files to look at after this note (to be generated in the next step):
- `infra/terraform/main.tf` — provider blocks (`oci` and `cloudflare`) and
  VM/VCN/subnet resources
- `infra/terraform/nsg.tf` — the NSG and its ingress rules
- `infra/terraform/cloudflare.tf` — the DNS `A` record and the R2 bucket
  (with `prevent_destroy`)
- `infra/terraform/outputs.tf` — the public IP output Ansible will consume

---

## SecOps Notes

**Security property upheld:** Network-layer least-privilege — the NSG is
the first of three overlapping network controls described in
`references/secops.md`'s Network Hardening section (NSG → Traefik →
Fail2ban). It exists specifically so that if Traefik's rate limiting or
Fail2ban's ban rules ever fail or are misconfigured, traffic to everything
except 80/443/SSH is already dropped before it reaches the VM at all.

**What it mitigates:** Without a restrictive NSG, every port the VM listens
on (e.g. PostgreSQL's 5432, or Vault's 8200 if bound to `0.0.0.0`) is
reachable directly from the internet, bypassing Traefik and Fail2ban
entirely. An open database port is one of the most common real-world causes
of full data breaches on cloud VMs.

**What would go wrong if skipped:** Provisioning the VM without an NSG (or
with an NSG that allows all inbound traffic) means every service's default
"bind to all interfaces" behavior becomes internet-facing by accident,
not by design.

**Also relevant — state file hygiene:** Terraform state can contain
sensitive values (e.g. if a resource's attributes include a generated
password). For this project: `terraform.tfstate` and `*.tfstate.backup`
are git-ignored, matching the same "no plaintext secrets committed"
checklist item Vault's topic covered. For a personal/free-tier project, a
local state file is acceptable, but you should understand that a team
project would use a remote backend (e.g. an encrypted OCI Object Storage
bucket) instead, precisely so the state — which can contain secrets — isn't
sitting in a git history forever.

---

## Checkpoint Questions

1. Why does `design.md` say "Terraform should NOT manage application
   deployment" — what goes wrong if Terraform's `remote-exec` provisioner
   is used to `docker compose up` the app directly?
2. In the worked example, what specifically would happen if you ran
   `terraform apply` twice in a row without changing `main.tf`? Why?
3. If someone deleted `terraform.tfstate` by accident, what's the actual
   risk the next time `terraform apply` runs — not just "state is gone,"
   but concretely what could happen to the OCI account's resources?
4. What are the three layers of network hardening this project uses, and
   which one does Terraform's NSG correspond to?
5. Why is a local `terraform.tfstate` file git-ignored rather than
   committed, even for a personal project?
6. Why does the R2 bucket get a `lifecycle { prevent_destroy = true }`
   guard while the VM doesn't? What's the actual difference between the two
   resources that justifies treating them differently?

---

## Summary

Built: `infra/terraform/main.tf` (OCI providers, VCN, internet gateway,
route table, subnet, free-tier compute instance), `nsg.tf` (NSG with
ingress limited to 80/443/SSH and an open egress rule), `cloudflare.tf`
(DNS `A` record with `proxied = false`, and an R2 bucket guarded by
`prevent_destroy`), `outputs.tf` (public IP, domain, bucket name), plus
`variables.tf`, `terraform.tfvars.example`, and a `.gitignore` update so
real `.tfvars`/state files are never committed.

Demonstrated understanding of: the role of each resource in `main.tf`
(including why `security_list_ids = []` avoids two overlapping firewall
mechanisms), why the NSG's egress is deliberately left open while ingress
is locked down, the difference between Vault-managed secrets and plain
Terraform outputs (correctly identified that a public IP isn't the kind of
thing Vault manages), and — after a guided correction — how Cloudflare's
`proxied` flag would break Traefik's future Let's Encrypt HTTP-01 challenge
by routing it through Cloudflare's edge (with Cloudflare's own certificate)
instead of straight to the VM.

To revisit: Ansible's dynamic inventory concept (`cloud.terraform.terraform_provider`)
wasn't known yet — expected, since it's covered properly in `4_ansible`,
the next topic. Worth a quick check-back once that topic is done that the
connection back to this one (`terraform output` → Ansible inventory) is
solid.
