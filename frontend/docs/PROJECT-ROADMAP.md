# Private Messenger

## Product
A sophisticated 1-to-1 messaging platform designed around privacy, real-time communication, and end-to-end encryption.

## Core architecture
- Next.js App Router + TypeScript for web
- Node.js + TypeScript API
- PostgreSQL + Prisma for durable data
- Redis for ephemeral state, rate limiting, presence and pub/sub
- WebSockets for real-time events
- Established secure messaging cryptography rather than custom cryptography
- SSR/RSC for public and data-appropriate pages
- Client-side cryptographic operations for E2EE

## Delivery phases

### Phase 01 — Homepage and product foundation
Status: IN PROGRESS
- [x] Product architecture documented
- [x] Homepage visual direction
- [x] Responsive hero
- [x] Floating message bubbles
- [x] Scroll-triggered reveals
- [x] Security section
- [x] Initial metadata
- [ ] Add design system tokens
- [ ] Add shadcn/ui primitives
- [ ] Add accessibility audit
- [ ] Add performance audit

### Phase 02 — Project infrastructure
- [ ] Monorepo
- [ ] Next.js web app
- [ ] Node.js API
- [ ] Shared TypeScript packages
- [ ] PostgreSQL
- [ ] Prisma
- [ ] Redis
- [ ] Docker development environment
- [ ] CI
- [ ] Environment validation

### Phase 03 — Authentication
- [ ] Signup
- [ ] Login
- [ ] Logout
- [ ] Secure server-side sessions
- [ ] Argon2id password hashing
- [ ] Email verification
- [ ] Password reset
- [ ] Rate limiting
- [ ] Security event logging

### Phase 04 — Direct messaging
- [ ] User profiles
- [ ] User search
- [ ] Direct conversations
- [ ] Message persistence
- [ ] Message pagination
- [ ] Optimistic UI

### Phase 05 — Real-time
- [ ] WebSocket authentication
- [ ] Redis pub/sub
- [ ] Online presence
- [ ] Typing indicators
- [ ] Delivery receipts
- [ ] Read receipts
- [ ] Reconnection and retry

### Phase 06 — End-to-end encryption
- [ ] Device identity
- [ ] Key lifecycle
- [ ] Prekey infrastructure
- [ ] Session establishment
- [ ] Ratchet state
- [ ] Per-message encryption
- [ ] Key verification
- [ ] Encrypted persistence
- [ ] Security testing
- [ ] Threat model review

### Phase 07 — Offline and multi-device
- [ ] IndexedDB encrypted local state
- [ ] Offline message queue
- [ ] Reconnect synchronization
- [ ] Device management
- [ ] Multi-device sessions

### Phase 08 — Groups
- [ ] Group membership
- [ ] Group encryption protocol
- [ ] Admin roles
- [ ] Invitations
- [ ] Group events

### Phase 09 — Production hardening
- [ ] Observability
- [ ] Metrics
- [ ] Error tracking
- [ ] Load testing
- [ ] Backup/restore testing
- [ ] Dependency auditing
- [ ] Security review
- [ ] Penetration testing

## Non-negotiable security principles
1. Do not invent cryptographic protocols.
2. Do not store passwords in plaintext or reversible encryption.
3. Do not put long-lived authentication tokens in localStorage.
4. Do not log plaintext message content.
5. The API must authorize every conversation/message operation.
6. Public cacheable content and private user data must have separate caching policies.
7. WebSocket connections must authenticate, authorize, validate Origin, enforce limits, and rate-limit abusive behavior.
8. Cryptographic state belongs to the client-side security boundary wherever the protocol requires it.

## Current implementation
Phase 01 homepage is implemented as a starting point. The homepage deliberately communicates privacy without claiming that E2EE is already operational. E2EE becomes a later engineering milestone and must be tested independently.
