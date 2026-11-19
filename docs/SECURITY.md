# Vulnerability reporting

Sophia is a private end-to-end encrypted messenger with an optional assistant. This page is how to tell the maintainer about a security problem. It is not a bug bounty and it does not promise a response time.

## Report privately

Use GitHub private vulnerability reporting for this repository:

[https://github.com/RichardQumsieh/project_2vs/security/advisories/new](https://github.com/RichardQumsieh/project_2vs/security/advisories/new)

Do not open a public GitHub issue, pull request, or discussion for an undisclosed vulnerability. Do not post exploit details in chat, on social media, or in a commit message.

If private reporting is unavailable, contact the repository owner through GitHub without including a working exploit in a public place. There is no separate security email published in this repository.

## What to include

- The affected version, commit, or deployment, if you know it.
- What an attacker can do, and what they already need (an account, a stolen device, a modified client, network position).
- A concise description of the impact. Proof-of-concept steps are welcome. Live secrets, other people's message contents, and access tokens are not.
- Whether the issue is in the API, the web app, a dependency, or the way production is configured.

## Please do not

- Access, modify, or delete data that belongs to someone else.
- Run denial-of-service tests against a deployment you do not operate.
- Social-engineer the maintainer or other users.
- Demand payment. No bounty is offered here.

## What happens next

The maintainer reads private reports and decides what to fix. This document does not commit to an acknowledgement window, a coordinated disclosure date, or legal safe harbor. A good-faith report that avoids other people's data is the expected path.

Committed credentials are listed for rotation in the pull request that removed them from the tree. Git history is not rewritten. If you find a further credential in history, report it the same way so the owner can rotate it.

## Related documents

- [Threat model and AI boundary](THREAT_MODEL.md)
- [Backup and new-device recovery drill](RECOVERY.md)
