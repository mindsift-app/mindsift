# Security Policy

## Supported versions

MindSift is released continuously. Security fixes go into the next release only; older versions do not get backports.

| Version | Supported |
|---|---|
| Latest release (image tag `:stable`, and `:latest` from `main`) | ✅ |
| Anything older | ❌ Please update |

Every tagged release is scanned with [Trivy](https://trivy.dev) before it is published, and the published `:stable` and `:latest` images are scanned again every week. Fixable vulnerabilities rated HIGH or CRITICAL stop a release.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability**. Only the maintainers can see the report.

Helpful to include:

- the MindSift version (shown in the app under "About MindSift") and how it is run (Docker, reverse proxy, demo mode),
- what an attacker can do and what they need for it (an account, a shared note, an API key, network access),
- steps or a request to reproduce it.

What happens next:

- You get an answer within about a week, usually sooner.
- Confirmed problems are fixed in a new release; the changelog names the fix once it is out.
- With your consent you are credited in the advisory.

## Scope

In scope: the MindSift server and web app in this repository, the published container images and the install script.

Out of scope: the public demo at demo.mindsift.app being reset or filled with nonsense (it resets on purpose), denial of service by sheer traffic, and problems in a reverse proxy or host setup that MindSift does not ship.
