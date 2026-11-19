# Sample Pre-Audit Report: LOVEH Lending Markets

**Auditor:** Bloodhound (human-validated scan)
**Date:** November 19, 2026
**Scope:** https://github.com/aeredium/LOVEH, commit `6daa861` ("LV2a: the foundation's till and the deployment of LOVEH1")
**Subject:** LOVEH, permissionless lending markets on the AEREDIUM chain. No owner, no admin key, no pause, no upgrade. Each market is immutable once created.

This is a sample report produced by Bloodhound's pre-audit scan service. It shows the format and depth a paying customer receives. No findings in this report have been submitted to any bug bounty program or contest.

## Scope and coverage

| Item | Count |
|---|---|
| Solidity files scanned | 42 (all files in the repo, excluding vendored libraries) |
| Contracts parsed | 52 |
| Core source contracts reviewed line by line | 8 (`Market`, `MarketFactory`, `ReceiptToken`, `FoundationTill`, `FixedPoint`, `KinkedRateFormula`, `LinearRateFormula`, `Utilisation`), 1,035 lines |
| Heuristic anomalies flagged | 39 |
| Heuristic anomalies confirmed | 0 High or Critical, 1 Low |
| Audit reports found in the repo | None |

## Method

1. Bloodhound's 8 heuristic checks ran over every Solidity file: reentrancy, access control, integer overflow and unchecked math, tx.origin, front-running, delegatecall, oracle manipulation, and unprotected initializer.
2. Every flagged anomaly was triaged against the actual code. The full triage table is in the appendix.
3. The core money paths were read manually: deposit, withdraw, borrow, repay, liquidate, collateral deposit and withdrawal, fee payment, interest accrual, market creation, and the receipt token.
4. The AI analyzer step was not run for this sample: no `OPENROUTER_API_KEY` was configured in the scanning environment, so this report rests on heuristics plus human validation only. The paid service runs the full pipeline including AI analysis.

## Findings summary

| ID | Title | Severity | Status |
|---|---|---|---|
| L-01 | Price source is unvalidated and unchecked for staleness | Low | Open |
| - | No Critical findings | - | - |
| - | No High findings | - | - |
| - | No Medium findings | - | - |

## L-01: Price source is unvalidated and unchecked for staleness

**Severity:** Low
**Location:** `src/MarketFactory.sol`, `createMarket()`; `src/Market.sol`, `_price()`
**Category:** Oracle trust assumptions

### Description

Anyone may create a LOVEH market by naming five terms: the loan token, the collateral token, the price source, the borrowing limit, and the rate formula. The factory validates the rate formula against an allowlist fixed at construction (`isPermittedRateFormula`), and it rejects zero addresses and duplicate markets. It does not validate the price source at all: any address passes, including an address that is not a price feed, a feed for a different asset pair, or a contract the market creator controls.

Every price-sensitive action in the market then trusts that source without further checks. `Market._price()` makes a `staticcall` to `priceSource.price()` and accepts any nonzero `uint256` answer. It does not check when the price was last updated, whether the answer is within any sane range, or whether the source is the feed the market's tokens actually need. There is no staleness bound anywhere in the market.

### Impact

A market's safety rests entirely on its price source, and the factory gives lenders no help telling a sound market from an unsound one:

- A market creator can deploy a price source contract that returns an inflated price, create a market against it, deposit low-value collateral, and borrow the market's full unlent balance. Lenders who deposited into that market lose their funds. The market's terms are public and immutable, so this requires luring lenders into a market they did not vet, which is why this is Low rather than High: it is a trust-assumption gap in permissionless market creation, not an exploit of the market code itself.
- A legitimate market whose price source goes stale keeps lending at the old price. If the collateral's real value falls while the feed is frozen, borrowers can take loans the collateral no longer backs, and liquidations may not trigger when they should. Borrowing, collateral withdrawal, and liquidation all read the same unchecked price.
- A price source that burns gas on every call can grief the market: `_price()` forwards the caller's remaining gas with no cap, so a gas-heavy source makes borrow, withdraw-collateral, and liquidate calls run out of gas. Deposit and repay do not read the price and keep working.

### Recommendation

Mirror the rate-formula pattern the factory already uses: keep an allowlist of permitted price sources, fixed at construction, and require `createMarket` to accept only listed sources. Separately, enforce a staleness bound in `_price()` (for example, require the source to expose an `updatedAt` and reject prices older than a market-defined maximum age), and cap the gas forwarded to the price source call so a faulty source cannot grief market functions.

### Why this is not higher severity

The market code itself handles the price correctly once read: a zero or failing price reverts the price-sensitive actions, liquidation math caps seized collateral at the amount held, and losses are contained to the single market. The gap is at the boundary where the protocol trusts a creator-chosen external contract, and every market's terms are visible on chain before anyone deposits.

## What checked out

The following held up under manual review and are worth naming, because they are the places a lending market usually breaks:

- **Accounting identity.** `U + L == D + F` (unlent plus loans equals deposits plus fee owed) holds after every action. Write-offs reduce deposits first and the unpaid fee only when the loss exceeds all deposits, so a loss never reaches another market.
- **Fee-on-transfer tokens.** Incoming transfers are credited by balance difference actually received, never by the amount requested, so a fee-taking token cannot create unbacked receipts, collateral, or repayments. The fee payment itself never reverts the caller's withdrawal: a refused fee transfer leaves the fee owed.
- **Share inflation.** Receipt and loan units use virtual offsets, so the first depositor cannot inflate receipt value by sending tokens to an empty market. Rounding always favors the market.
- **Reentrancy.** Every state-changing function carries `nonReentrant`, state is updated before external transfers, and the low-level fee call in `_trySendFee` cannot reenter any guarded entry point.
- **Liquidation.** Seized collateral is capped at the amount held, the loan is settled before the transfer, and a borrower whose collateral is exhausted has the remainder written off against that market's lenders only.
- **Rate formulas.** Only allowlisted formulas can be used, parameters are fixed at deployment, and the accrual math reverts rather than wrapping on overflow.

## Appendix A: heuristic triage

All 39 flagged anomalies, and why each was cleared or recorded. "Test" rows are Foundry test files, which are out of scope for findings but are listed for completeness.

| # | Location | Check | Disposition |
|---|---|---|---|
| 1 | `interfaces/IMarket.sol`, `withdrawCollateral` | Access control | Interface stub, no body by definition. Discard. |
| 2 | `interfaces/IReceiptToken.sol`, `mint` | Access control | Interface stub. Discard. |
| 3 | `interfaces/IReceiptToken.sol`, `burn` | Access Control | Interface stub. Discard. |
| 4 | `src/Market.sol`, `_trySendFee` | Reentrancy | False positive. Called only from `withdraw` and `payFee`, both `nonReentrant`, after all state updates. No reentry path. |
| 5 | `src/ReceiptToken.sol`, `burn` | Overflow | False positive. `unchecked` subtraction is guarded by a balance check immediately above it. |
| 6 | `src/ReceiptToken.sol`, `_transfer` | Overflow | False positive. Same guard as above. |
| 7-39 | `test/*.sol` and `test/mocks/MockERC20.sol` (33 rows) | Access control, reentrancy, oracle manipulation | Test files and mocks. Out of scope. The test names themselves record the intended behavior (fee handling, frozen recipients, liquidation rules). |

## Appendix B: other repositories scanned in this batch

Two further new, unaudited repositories were scanned with the same pipeline on the same day. Neither produced a High or Critical finding, and neither is the subject of a full report here.

- **onixs** (https://github.com/onixsxyz/onixs, commit `de0672d`): stock-token lending on Robinhood Chain, live on mainnet since October 14, 2026. 12 Solidity files, 25 contracts, 11 anomalies. The two real source hits were cleared on review: `OnixsBerth.initialize` is guarded by a charter-only caller check plus an already-set check (the implementation sets the owner to `address(1)` so it can never be initialized), and `OnixsBerth.sweep` is owner-only behind a reentrancy lock. No audit reports in the repo.
- **slate** (https://github.com/Slate-Protocol/slate, commit `c2bba96`): oracle feeds for Robinhood Chain stock tokens without Chainlink feeds, live on mainnet since October 3, 2026. 50 of 51 files parsed, 81 contracts, 25 anomalies. The one skipped path was a Foundry broadcast output directory, not source code. Real source hits were scripts, an interface stub, and `SlateRouter._buy`, which reads the feed price, executes the swap, then reverts unless the effective price lands inside a band around the feed price. No audit reports in the repo; the project states in its own docs that it is unaudited hackathon software and discloses one known limitation (a later multiplier schedule can hide an earlier switch), which is already known to the team and is not counted as a finding here.

## Limitations

This is a sample pre-audit scan, not a full audit. It covers the repository as committed on November 19, 2026. It does not cover deployment configuration, off-chain infrastructure, the price sources markets choose, or the economic behavior of any token a market accepts. Findings are stated as of the scanned commit; later commits may change them.

---

*Bloodhound pre-audit scans: Standard $250 (up to 5 contracts), Full Repo $450 (unlimited contracts), 3-Day Pre-Audit Sprint $1,500. Every finding is human-validated, and High severity findings include a Foundry PoC. Order: christopherperceptions@gmail.com or DM @PerceptionsPray on X. Payment: Stripe link or USDC.*
