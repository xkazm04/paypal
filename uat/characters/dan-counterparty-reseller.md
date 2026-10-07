---
name: dan-counterparty-reseller
display: Dan, reseller across the table
segment: counterparty whose agent sells under his own mandate
references:
  - docs/design/the-table.extract.txt
  - docs/design/window-duality.md
  - AGENTS.md
  - docs/security/scan-2026-10-07.md
---

Maya, Dan and Second Screen are invented for illustration, as the design report says. The report
gives Dan only a few lines, so most of this file is marked **assumption**.

## Who they are

Dan resells surplus office monitors. His agent bargains under Dan's own mandate; the floor stays
hidden from Maya. His wallet issues the order, captures it and sends Maya a signed receipt
(report, "Counterparty - Dan's wallet"). Identity is a paired key with four words checked on both
screens (report). That he is a small reseller with his own wallet and PayPal business account is
an **assumption**.

## Voice

Not described in the docs. **Assumption:** terse trader; cares about margin and about not being
pushed below his number.

## Jobs-to-be-done

- Open a table (list $389, floor hidden) and let his agent bargain asks down inside his band
  (report, video 0:12-1:05).
- Get paid: issue the order, capture, send the signed receipt (report).
- Quote the catalog to other people's agents ("counter") (report).

## What good looks like

His floor never leaves his wallet: when his agent tries a price below it, the core refuses and the
deal stays where it was (report, video 1:05-1:20). Both sides end with the same receipt hash
(report). Counterparty free text (Maya's notes) is never fed to his agent as instructions
(AGENTS.md invariants).

## Pet peeves

- **Assumption:** his floor or mandate showing up on Maya's screen. Scan finding C-14
  (`docs/security/scan-2026-10-07.md`) flags that HOUSE may return its mandate, a possible public
  floor; a reviewer should treat any floor disclosure to a counterparty as a defect.
- **Assumption:** an agent conceding below the floor, or a deal settling without a signed receipt.

## Motivation (time-saved)

- Current manual way: not stated in the docs. **Assumption:** he haggles by message and invoices by
  hand.
- What the app should save: his agent haggles inside his mandate and the wallet captures and
  receipts without him, while he keeps the floor secret. No time figure is claimed.

## Senior-quality bar

A reviewer playing Dan must be unable to find any path by which the buyer side reads his floor, any
concession below it, or a capture without his signed authority (AGENTS.md: every agent intent
passes the mandate check; refused intents leave zero `paypal_calls` rows).

## Surface binding

- Windows: his own copy of `main`, `tumbler` and `approval` on the seller wallet (window-duality
  §1). In the video he is the right-hand desktop.
- Features: counter-agent-shop, house-seller-demo (the HOUSE seller is the scripted stand-in for
  Dan on a judge's install, report path 4), mandate-authoring (his own mandate), audit-trail-export
  (the shared receipt hash).
- Authority: the seller wallet may authorize and capture an order the buyer already approved on
  PayPal, with no click (AGENTS.md invariant 2).
