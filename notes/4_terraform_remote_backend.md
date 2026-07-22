# Terraform Remote Backend — Cloudflare R2 State Storage

**Phase:** 4 — Cloud Infrastructure & Hardening
**Topic ID:** `4_terraform_remote_backend` (detour extending `4_terraform`)
**Date:** 2026-07-22
**SecOps:** Yes

---

## What Is This?

A Terraform **backend** decides *where the state file lives* and how reads/
writes to it are coordinated. So far this project uses the default: the
`local` backend, which just means "a file called `terraform.tfstate` sitting
next to your `.tf` files." A **remote backend** moves that same file to a
shared location — here, a Cloudflare R2 bucket — so it isn't tied to one
laptop's disk. R2 is Cloudflare's object storage product, and critically, it
speaks the same S3 API that AWS S3 does — so Terraform's built-in `s3`
backend type can point at R2 just by giving it a different `endpoints` URL.
No new backend type to learn, no new provider plugin — the same mechanism,
redirected.

---

## Why Does It Matter for This Project?

`notes/4_github_actions.md` already ran into this gap directly: it explains
that the CI/CD pipeline deliberately does **not** run Terraform, and one
concrete reason given is *"no remote state backend exists yet."*
`generate_inventory.sh` has to read the VM's IP from a GitHub Secret you set
by hand, instead of `terraform output`, because a GitHub Actions runner has
no access to a state file sitting only on your machine. `notes/4_terraform.md`
flagged the same thing from the other direction: state can contain sensitive
values, and a local file is "acceptable for personal projects" but not for
anything beyond that. This topic closes both gaps at once, using
infrastructure you already pay nothing extra for (R2).

---

## The Decision

**Decision 1 — which remote backend?**

Chose: Cloudflare R2, via Terraform's built-in `s3` backend type pointed at
R2's S3-compatible endpoint.

Because: this project already has a Cloudflare account and the `cloudflare`
provider in play (for the uploads bucket and — historically — DNS). Reusing
R2 means no new vendor account, no new bill, and R2 has zero egress fees —
relevant because every `plan`/`apply` reads the whole state object.

Alternative: Terraform Cloud's free tier (a backend built specifically for
this purpose, with a web UI, run history, and real state locking).

Drawback: another third-party account and set of credentials to manage, for
a benefit (UI, run history) this solo project doesn't need. It's the more
common choice for teams — worth knowing it exists, not worth adopting here.

Alternative: an OCI Object Storage bucket (this was the specific example
`4_terraform.md`'s SecOps notes speculated about).

Drawback: it ties the *record of what infrastructure exists* to the same
cloud account that infrastructure runs in. If the OCI account is ever
suspended, mis-configured, or hits a regional issue, you'd lose visibility
into your infra at the exact moment you need it most. Keeping state in a
different provider (Cloudflare) than compute (OCI) is a deliberate blast
radius split.

**Decision 2 — a new bucket, not the existing `bggg-uploads` bucket.**

Chose: a dedicated `bggg-terraform-state` bucket, created *outside* the main
Terraform config (see Decision 3).

Because: state and uploaded photos have nothing in common except "both are
objects in R2." State changes shape and size on every `apply`; uploads are
inert app data with a completely different access pattern and different
consumers (the API's S3 SDK client vs. Terraform itself). Mixing them means
a bug or overly-broad credential in one system can now touch the other.

Alternative: store state inside `bggg-uploads` under a `terraform/` prefix.

Drawback: the R2 API token that Terraform needs for state read/write would
now also have reach into the same bucket the NestJS API writes real user
photos to — widening what a leaked Terraform credential could do.

**Decision 3 — how does the bucket that stores state get created, if
Terraform needs that bucket to exist before it can store *anything*?**

This is the actual hard part, and it's a real, well-known Terraform problem,
not something specific to R2: **a config cannot use a backend that depends
on a resource declared inside that same config.** The backend is resolved
before any resource block runs.

Chose: a tiny, separate **bootstrap** Terraform config
(`infra/terraform/bootstrap/`) that itself uses the plain local backend, and
whose only job is to create the `bggg-terraform-state` R2 bucket. You run it
once, by hand, the same way you ran the very first `terraform apply` for
this whole project. After that bucket exists, the *main* config's `backend`
block can point at it.

Because: it's the standard, industry-recognized pattern for exactly this
chicken-and-egg problem (HashiCorp's own docs describe the same shape for
S3+DynamoDB bootstrapping). It keeps the bootstrap config's own state file
— which is tiny, describes one bucket, and is touched maybe once a year —
as an acceptable, deliberate exception to "state should be remote."

Alternative: create the bucket by hand in the Cloudflare dashboard, outside
Terraform entirely.

Drawback: this is exactly the "exists only in someone's memory of clicking a
button" problem `4_terraform.md` already rejected once for the uploads
bucket. A from-scratch rebuild of this project's cloud footprint would
silently need one manual dashboard step nobody wrote down.

**Decision 4 — where do the R2 credentials (and the endpoint) Terraform
needs come from?**

There's a subtlety here worth being precise about: the `cloudflare_api_token`
variable already in `variables.tf` is a **Cloudflare account-wide API
token**, used by the `cloudflare` *provider* to manage resources (create a
bucket, set its settings) through Cloudflare's own control-plane API. The
`s3` *backend*, by contrast, talks to R2's **S3-compatible data-plane API**,
which authenticates with a completely different credential type: an R2
**Access Key ID / Secret Access Key** pair, generated separately (Cloudflare
dashboard → R2 → "Manage API tokens" → create a token scoped to just this
one bucket).

Chose: supply these as three environment variables —
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and (this part came out of a
follow-up question, not the first draft) `AWS_ENDPOINT_URL_S3` for the R2
endpoint URL itself — never written into any `.tf` file or `.tfvars` file.
The `s3` backend is built on AWS SDK v2, which reads all three by
convention; Terraform doesn't need to know about R2 specifically for any of
them to work.

Because: **backend blocks cannot reference variables at all** — not
`var.x`, not a `.tfvars` file, nothing. It's a hard Terraform limitation
(the backend has to be resolved before the variable system is even loaded).
The credentials clearly have to be env vars (they're secret). The endpoint
technically didn't — it isn't secret, and could have stayed a literal in
`backend.tf` (the account ID it embeds already sits in plain `terraform.tfvars`
as `cloudflare_account_id`) — but moving it to the same env var mechanism
keeps `backend.tf` portable across clones/forks with zero edits, and keeps
every backend-specific setting in exactly one place (the environment)
instead of split across a committed file and env vars.

Alternative: leave `endpoints.s3` as a hardcoded literal in `backend.tf`
(the account ID isn't secret) and only move the two genuinely secret values
to environment variables.

Drawback: this is a legitimate option, not a wrong one — just a different
tradeoff. It means `backend.tf` isn't identical across every clone of this
repo, and anyone rebuilding this project into their own Cloudflare account
has to remember to edit committed HCL, not just set env vars, to get
running.

Alternative: a `-backend-config=backend.hcl` file passed on the CLI,
holding the endpoint (and optionally the credentials).

Drawback: Terraform's own officially documented mechanism for exactly this
case — more discoverable than relying on AWS-SDK-inherited env var
behavior — but it's one more git-ignored file to create and keep in sync
per machine, for no benefit over environment variables here.

---

## Worked Example

This does **not** touch Cloudflare or R2 — it uses MinIO, a self-hosted
S3-compatible server you can run in one `docker run` command, to isolate
the actual mechanic (a backend block, migrating existing state into it, and
proving a second "machine" can pick that state back up) from any real
account or credentials.

### Scenario

You have a local Terraform project with existing local state. You want to
move that state to a remote, S3-compatible store, and then prove a
completely fresh checkout of the project (simulating a new machine, or your
laptop being lost) can still see that state.

### Code / Configuration

Start MinIO and create a bucket:
```bash
docker run -d --name minio-demo -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=demo -e MINIO_ROOT_PASSWORD=demo12345 \
  minio/minio server /data --console-address ":9001"

# The mc (MinIO Client) container just runs one command against the server
# above and exits — creating the bucket the backend below will write into.
docker run --rm --network host minio/mc \
  sh -c "mc alias set local http://localhost:9000 demo demo12345 && mc mb local/tf-state-demo"
```

`main.tf`:
```hcl
terraform {
  required_providers {
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # The s3 backend type works against ANY S3-compatible API — MinIO here,
  # R2 in the real project. Only the endpoint URL changes.
  backend "s3" {
    bucket = "tf-state-demo"
    key    = "demo.tfstate"      # the "filename" of the state object inside the bucket
    region = "auto"              # R2/MinIO don't have AWS regions; "auto" satisfies the backend's requirement for a value

    endpoints = {
      s3 = "http://localhost:9000"
    }

    # These three "skip_*" flags exist because the s3 backend normally
    # verifies it's really talking to AWS (checking region lists, asking
    # STS for your account ID). None of that applies to an S3-compatible
    # store, so each check is explicitly turned off rather than failing.
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true   # MinIO/R2 use path-style URLs (host/bucket/key), not AWS's virtual-hosted style (bucket.host/key)
  }
}

resource "random_id" "demo" {
  byte_length = 4
}

output "value" {
  value = random_id.demo.hex
}
```

### What Is Happening Step by Step

1. **First `terraform init`**, with credentials passed as env vars
   (`AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demo12345 terraform init`).
   Since there's no prior local state yet, this just configures the backend
   — Terraform confirms it can reach MinIO and creates an (empty) state
   object at `tf-state-demo/demo.tfstate`.

2. **`terraform apply`** creates `random_id.demo` and writes the updated
   state — containing the generated hex value — directly to MinIO over
   HTTP. Nothing is written to a local `.tfstate` file at all; check the
   directory and there isn't one.

3. **Open `http://localhost:9001`** (MinIO's web console, login `demo` /
   `demo12345`) and look inside `tf-state-demo`. `demo.tfstate` is sitting
   there as a real object — this is the concrete, visible proof that state
   moved off the local disk.

4. **Simulate a lost laptop**: delete the entire `.terraform/` directory
   (the provider plugin cache and backend connection info) and run
   `terraform init` again from a completely clean folder containing only
   `main.tf`. It reconnects to the *same* backend and finds the *same*
   state — `terraform plan` reports "no changes," even though this "new
   machine" never saw `random_id.demo`'s value before.

5. **Change the bucket name in `main.tf` to something that doesn't exist**
   and run `terraform init`. It fails immediately, before touching any
   resource — this is the literal shape of the chicken-and-egg problem:
   Terraform must be able to read/write the backend's target *before* it
   will do anything else, so that target can never be a resource created by
   the same `apply` that needs the backend.

### What Would Break If You Changed X?

If you removed `use_path_style = true`, requests would go to
`tf-state-demo.localhost:9000/...` (virtual-hosted style) instead of
`localhost:9000/tf-state-demo/...` (path style) — MinIO (and R2) don't
support the virtual-hosted form the same way AWS S3 does, so every backend
operation would fail with a connection or DNS-style error, even though the
credentials and bucket are completely correct. This is the single most
common "why won't Terraform talk to my S3-compatible store" mistake.

---

## Now Apply It

Files to be generated next, one at a time:

- `infra/terraform/bootstrap/main.tf` — the one-time bootstrap config:
  local backend, creates just the `bggg-terraform-state` R2 bucket with
  `prevent_destroy` (same guard pattern as the uploads bucket).
- `infra/terraform/bootstrap/variables.tf` + `terraform.tfvars.example` —
  reuses the same `cloudflare_api_token` / `cloudflare_account_id` shape
  already in the main config's `variables.tf`.
- `infra/terraform/backend.tf` — the `s3` backend block for the *main*
  config, pointed at the bucket the bootstrap config just created.
- An update to `infra/terraform/terraform.tfvars.example` documenting the
  three required environment variables (`AWS_ENDPOINT_URL_S3`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) and where the last two come
  from (Cloudflare dashboard → R2 → "Manage API tokens").
- After all files exist and you've read them: running
  `terraform init -migrate-state` in the *main* config folder, which is the
  real-world equivalent of worked-example step 2 above — except this time
  it migrates your **actual existing state** (the real VM, VCN, NSG,
  DNS/uploads-bucket resources already in `terraform.tfstate`) into R2,
  not a throwaway demo value.

---

## SecOps Notes

**Security property upheld:** credential and blast-radius separation. The
R2 Access Key/Secret used by the backend can be scoped (in the Cloudflare
dashboard) to exactly one bucket — it never needs to be able to touch the
uploads bucket, the OCI account, or anything else. This is the same
least-privilege principle the NSG topic applied to network traffic, applied
here to a credential instead.

**What it mitigates:** state files often contain sensitive values inside
resource attributes (this project's own `4_terraform.md` flagged this
generically). A remote backend with a narrowly-scoped credential means a
compromise of, say, a CI runner's secrets doesn't hand an attacker a
readable/writable copy of everything Terraform has ever touched — only
whatever that one credential is scoped to.

**What would go wrong if skipped:** state stays local, which — as
`4_github_actions.md` already documented as a live limitation — means CI
can never read `terraform output`, and losing the one machine holding
`terraform.tfstate` doesn't just lose a convenience file. The next
`terraform apply` from a fresh state would have no memory of the VM, VCN, or
buckets that already exist in OCI/Cloudflare, and would likely try to
create duplicates rather than erroring cleanly.

**Worth flagging honestly:** the AWS `s3` backend added native state
*locking* (preventing two people from running `apply` at the same second)
via conditional writes in Terraform 1.10, and Cloudflare has advertised R2
support for the conditional-request headers this depends on. I have not
verified this against current Cloudflare docs at the time of writing this
note. For a solo project this is a nice-to-have, not a blocker — the actual
risk it guards against (two concurrent applies corrupting state) requires
two people/processes running Terraform at once, which doesn't happen here.
Worth a five-minute check before ever adding a second contributor.

---

## Checkpoint Questions

1. What specifically stops you from declaring the `bggg-terraform-state`
   bucket as a normal `cloudflare_r2_bucket` resource inside the *main*
   Terraform config, the same way `bggg-uploads` is declared?
2. Why can't the R2 Access Key ID / Secret Access Key be put in
   `terraform.tfvars` the way `cloudflare_api_token` and `oci_fingerprint`
   are?
3. In the worked example, what would you see (concretely, in the terminal)
   if you ran `terraform init` pointed at a bucket that doesn't exist yet?
4. Walk through what happens the first time you run
   `terraform init -migrate-state` against this project's real,
   already-populated `terraform.tfstate` — where does the data end up, and
   what happens to the old local file?
5. Why does the `cloudflare_api_token` variable (used by the `cloudflare`
   provider) and the R2 Access Key/Secret (used by the backend) need to be
   two separate credentials instead of one?

---

## Summary

*(to be filled in after the checkpoint)*
