# Architecture Decision Record

## ADR-001 — Next.js App Router
Decision: Use Next.js App Router with TypeScript.
Reason: Server Components and modern rendering/caching capabilities fit the public product pages while client components can handle interactive chat behavior.

## ADR-002 — Motion for animation
Decision: Use Motion for React.
Reason: It supports enter/exit, scroll-triggered and scroll-linked animation while allowing the implementation to remain component-oriented.

## ADR-003 — Tailwind CSS
Decision: Use Tailwind CSS 4 with the current Next.js integration.
Reason: Utility-first styling and zero-runtime CSS generation provide a fast foundation for the design system.

## ADR-004 — No custom cryptography
Decision: Use established secure messaging cryptographic specifications/implementations rather than inventing a protocol.
Reason: Secure messaging requires key agreement, authentication, ratcheting, replay handling, device state, recovery properties and careful implementation beyond basic encryption.

## ADR-005 — Direct messaging before groups
Decision: Build 1-to-1 conversations first.
Reason: It reduces the initial protocol and product surface while allowing the data model to be designed for future groups.

## ADR-006 — Separate API from web
Decision: Keep Node.js API separate from Next.js.
Reason: Real-time messaging, WebSocket lifecycle, security boundaries and future clients benefit from an independent API layer.

## ADR-007 — Server cannot decrypt messages
Decision: The production messaging architecture will make ciphertext the server-side message representation.
Reason: This is necessary for genuine end-to-end encryption rather than merely encrypted database storage.
