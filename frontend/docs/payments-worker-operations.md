# Payment reconciliation worker operations

The worker calls the application's authenticated reconciliation endpoint. It never captures a payment automatically. Webhooks remain required. A successful batch drains the next batch after one second; an idle or unsuccessful round waits five minutes. A request has a 125-second timeout, and an invalid worker secret stops the process with exit code 1.

## Local health contract

Set `PAYMENTS_WORKER_HEALTH_FILE` to an absolute file path inside an existing private writable directory. This is optional for existing local runners. It enables an atomic health record containing only status, timestamps, batch counts and consecutive failures. It contains no credentials, request headers, provider response bodies or payment identifiers. Each process needs its own health path; do not let different applications or worker replicas share it.

The file starts as unhealthy on every process start. A completed successful round, including an empty queue, makes it healthy. Any failed round immediately makes it unhealthy; a later successful round resets the failure count. Graceful shutdown records `stopped`. A killed process is detected when its last success is more than 450 seconds old. The allowance covers the normal five-minute idle interval and the bounded request timeout. A timestamp more than 30 seconds in the future also fails the probe.

```sh
PAYMENTS_WORKER_HEALTH_FILE=/run/needs-payments/health.json \
  node scripts/payments-reconciliation-worker.mjs --health-check
```

This probe only reads the local health file; it does not contact the application, need a worker secret or change payments. It exits 0 when healthy and 1 otherwise. Missing, malformed, failed and stale state all fail closed. A configured health file that cannot be written stops the worker instead of silently disabling monitoring. `--once` preserves the result of that single round for scheduled invocations; continuous workers mark graceful shutdown explicitly.

## Linux supervision templates

The three files under `ops/systemd/` are **inactive templates**, not an installed service. They assume a dedicated `needs-payments` OS account, Node at `/usr/bin/node`, code under `/srv/needs/frontend`, and the private environment file `/etc/needs/payments-worker.env`. The health probe does not read the environment file. The service manager creates a private runtime directory, restarts failed worker processes, and limits rapid restart loops. A separate timer runs the local health probe every minute. These behaviors follow the official [service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [execution environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) and [timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) contracts.

Before any installation, select the intended NEEDS host and application origin. Verify that application's Stripe account and test/live mode independently. The scheduler has no Stripe credentials and cannot identify a misconfigured application's Stripe account itself. Do not point it at another project's application or reuse another project's secret. On a shared database the queue is global; a temporary sandbox worker must run only in an audited exclusive fixture window, never as an unattended service alongside another account's payments.

Prepare on that host:

1. Install the Node version required by `package.json`, create the dedicated unprivileged account, and deploy the worker script at the configured path. Adjust all three templates consistently if paths differ. No Next server, Stripe CLI listener or email worker is started by these templates.
2. Store only `NEXT_PUBLIC_APP_URL` and `PAYMENTS_WORKER_SECRET` in the root-owned, mode-0600 environment file. Use the exact HTTPS application origin (local HTTP is accepted only for loopback). The secret must match the server-only application value and contain at least 32 characters. Keep `PAYMENTS_WORKER_HEALTH_FILE` out of this file because the templates set it explicitly.
3. Run `systemd-analyze verify` against the three actual unit files on the Linux host before installation. Then install and enable `needs-payments-worker.service` and `needs-payments-health.timer` through the host's normal deployment process.
4. Connect the host's existing monitoring to nonzero health-probe exit status, a failed worker unit, sustained reconciliation errors and a stopped health timer. Route that signal to the chosen operator channel and verify receipt with an intentional local health failure. The templates write to the journal; they do not provision or send external alerts.
5. Verify healthy empty and nonempty rounds, failure/recovery, process restart, a full five-minute idle interval and stale-state detection in the selected sandbox before treating operation as supervised. Retain the result and exact target identity.

Useful host checks after an approved installation:

```sh
systemctl status needs-payments-worker.service needs-payments-health.timer
systemctl list-timers needs-payments-health.timer
journalctl -u needs-payments-worker.service -u needs-payments-health.service --since '30 minutes ago'
```

Stopping only the worker intentionally leaves the health timer reporting failure; planned maintenance must also stop the health timer or silence the operator's monitor. On restart, authentication errors need the application/worker secret mismatch fixed before resetting the failed unit. Do not rotate Stripe accounts while existing payments still need reconciliation.

## Verification limits

The automated Node tests verify the worker's health-state transitions, missing/malformed/stale state, failed-batch recovery, strict two-row batch bounds, credential-free CLI probes and absence of secrets in logs/state. They do not establish that a Linux unit was installed, an operator received an alert, or the intended hosted environment has been selected. Those remain deployment checks. No service installation, external notification or live configuration is performed by adding these files.
