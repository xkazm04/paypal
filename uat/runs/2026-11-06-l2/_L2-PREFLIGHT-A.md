# L2 preflight - pass A (Maya, Tomasz, Priya, Lena, Omar, Dan)

Driver: headless Chrome via playwright-core (Chrome extension not used). Viewport 1400 wide unless noted. Each page = fresh context, so the mock's localStorage store is ephemeral: this run wrote nothing durable (no residue to trace). Screenshots: `shots/A/`.

| Precondition | Result | Arm / evidence |
|---|---|---|
| Server up | PASS | `GET http://localhost:1430/index.html` -> 200; reused, no second server |
| Mock data non-empty (default "Sample week") | PASS | rail counts Tables 8, Spend 6, Counter 4, Book 23, Shield 2, Rescue 3; "6 need you" |
| Deals distinct, not clone-stamped | PASS | Book CSV: 23 rows, 23 distinct deal ids, 16 distinct amounts, 9 counterparties, 6 kinds (haggle, purchase, shop_order, rescue) |
| Recorded house haggle D-0205 | PASS | Book row "27-inch 4K monitor ... Seller says paid $324.00"; deal page + signed-proof export work |
| Large world | PASS | `?scale=large`: Spend "1-20 of 120", 8 rule sets in force, wallet limit $250,000/day |
| First-run world | PASS | `?first_run=1`: "Not set up yet", Charter 0 of 5 lines |
| Locked state | PASS | `?locked=1` -> Charter "3 of 5 lines signed" |
| Identity chrome | NONE (correct for mock) | no signed-in header / org name; chrome shows "Sandbox" + "Preview · sample data" + "Unlocked"; no PayPal, keychain or Windows Hello is reachable |
| Wallet "no native Hello" arm (`native_reauth_available=false`) | NOT BUILDABLE | flag lives in the mock settings fixture, not a URL param; resolves OMAR-L1-09 `uncertain`. Closing fixture: URL param `?hello=off` in mock/backend.ts |
| Buyer purchase with PayPal outcome unchecked (`money_check` set, AUTHORIZED) | NOT BUILDABLE | mock only has `money_check` on seller-side shop orders (fixtures.ts:418, scale.ts:574). Closing fixture: a buyer purchase with `check:{step:'capture',state:'parked'}`. Resolves MAYA-L1-09 `uncertain` |
| Dan-side wallet seller (relay / floor policy) | NOT BUILDABLE in browser | needs a scripted buyer client + Rust relay harness. Resolves DAN-L1-01..03,06,08 `uncertain` |
| Native Rust proof check, native save dialog, Rust audit rows | NOT BUILDABLE | native Tauri shell is out of scope |

Suspect-provenance note: Book row D-0201 "Refurbished 24-inch IPS monitor ... $0.01 ... House seller ... Connecting" is a seeded fixture (mock/fixtures.ts), not UAT residue.
Mock clock runs on wall time (row times drift minute by minute); numbers quoted are from the run at ~09:13-09:30 local.
