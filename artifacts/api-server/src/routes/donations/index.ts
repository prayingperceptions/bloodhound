import { Router, type IRouter } from "express";
import { db, donorsTable } from "@workspace/db";
import { eq, and, gt, isNull, or, desc } from "drizzle-orm";
import { GetDonationStatusResponse, VerifyDonationBody, ListSponsorsResponse } from "@workspace/api-zod";
import crypto from "crypto";

const router: IRouter = Router();

export const DONATION_ADDRESS = "0x2091125bFE4259b2CfA889165Beb6290d0Df5DeA";
const ETH_RPC = "https://eth.llamarpc.com";

const TIER_THRESHOLDS = {
  lifetime: BigInt("1000000000000000000"), // 1 ETH
  medium: BigInt("100000000000000000"),    // 0.1 ETH
  small: BigInt("10000000000000000"),      // 0.01 ETH
};

export const TIER_INFO = {
  small:    { ethMin: 0.01, hunts: 30, days: 30 },
  medium:   { ethMin: 0.1,  hunts: 30, days: 360 },
  lifetime: { ethMin: 1,    hunts: "Unlimited" },
};

export async function getActiveDonor(ip: string) {
  const now = new Date();
  const rows = await db
    .select()
    .from(donorsTable)
    .where(
      and(
        eq(donorsTable.ip, ip),
        or(isNull(donorsTable.expiresAt), gt(donorsTable.expiresAt, now))
      )
    )
    .orderBy(desc(donorsTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export function buildDonationStatus(donor: (typeof donorsTable.$inferSelect) | null) {
  const base = {
    donationAddress: DONATION_ADDRESS,
    tiers: TIER_INFO,
  };
  if (!donor) {
    return { ...base, tier: "free" as const, huntsRemaining: null, huntsUsed: 0, expiresAt: null, isSponsor: false };
  }
  const huntsRemaining = donor.huntLimit === null
    ? null
    : Math.max(0, donor.huntLimit - donor.huntsUsed);
  return {
    ...base,
    tier: donor.tier as "small" | "medium" | "lifetime",
    huntsRemaining,
    huntsUsed: donor.huntsUsed,
    expiresAt: donor.expiresAt?.toISOString() ?? null,
    isSponsor: donor.isSponsor,
  };
}

// GET /donations/status
router.get("/donations/status", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  const donor = await getActiveDonor(ip);
  res.json(GetDonationStatusResponse.parse(buildDonationStatus(donor)));
});

// GET /donations/sponsors
router.get("/donations/sponsors", async (req, res): Promise<void> => {
  const sponsors = await db
    .select({ address: donorsTable.ethFromAddress, since: donorsTable.createdAt })
    .from(donorsTable)
    .where(eq(donorsTable.isSponsor, true))
    .orderBy(donorsTable.createdAt);

  res.json(ListSponsorsResponse.parse(sponsors.map((s) => ({
    address: s.address,
    since: s.since.toISOString(),
  }))));
});

// POST /donations/verify
router.post("/donations/verify", async (req, res): Promise<void> => {
  const parsed = VerifyDonationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { txHash } = parsed.data;
  const ip = req.ip ?? "unknown";

  // Validate tx hash format
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    res.status(400).json({ error: "Invalid transaction hash format." });
    return;
  }

  // Check if this tx was already used
  const existing = await db
    .select({ id: donorsTable.id })
    .from(donorsTable)
    .where(eq(donorsTable.txHash, txHash.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    res.status(400).json({ error: "This transaction has already been used to unlock a quota." });
    return;
  }

  // Verify transaction on-chain
  let txData: { to: string; value: string; from: string; blockNumber: string | null } | null = null;
  try {
    const rpcRes = await fetch(ETH_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionByHash",
        params: [txHash],
        id: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const rpcJson = await rpcRes.json() as { result?: { to: string; value: string; from: string; blockNumber: string | null } | null };
    txData = rpcJson.result ?? null;
  } catch (err) {
    req.log.error({ err }, "Failed to reach Ethereum RPC");
    res.status(400).json({ error: "Could not verify transaction — Ethereum RPC unavailable. Try again shortly." });
    return;
  }

  if (!txData) {
    res.status(400).json({ error: "Transaction not found on Ethereum mainnet." });
    return;
  }

  if (txData.blockNumber === null) {
    res.status(400).json({ error: "Transaction is still pending. Wait for it to be confirmed and try again." });
    return;
  }

  if (txData.to?.toLowerCase() !== DONATION_ADDRESS.toLowerCase()) {
    res.status(400).json({ error: `Transaction recipient does not match the Bloodhound donation address (${DONATION_ADDRESS}).` });
    return;
  }

  const amountWei = BigInt(txData.value);

  if (amountWei < TIER_THRESHOLDS.small) {
    const minEth = (Number(TIER_THRESHOLDS.small) / 1e18).toString();
    res.status(400).json({ error: `Donation amount is below the minimum (${minEth} ETH).` });
    return;
  }

  // Determine tier
  let tier: "small" | "medium" | "lifetime";
  let huntLimit: number | null;
  let expiresAt: Date | null;
  let isSponsor: boolean;

  if (amountWei >= TIER_THRESHOLDS.lifetime) {
    tier = "lifetime";
    huntLimit = null;
    expiresAt = null;
    isSponsor = true;
  } else if (amountWei >= TIER_THRESHOLDS.medium) {
    tier = "medium";
    huntLimit = 30;
    expiresAt = new Date(Date.now() + 360 * 24 * 60 * 60 * 1000);
    isSponsor = false;
  } else {
    tier = "small";
    huntLimit = 30;
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    isSponsor = false;
  }

  const id = crypto.randomUUID();
  const [donor] = await db
    .insert(donorsTable)
    .values({
      id,
      ip,
      txHash: txHash.toLowerCase(),
      ethFromAddress: txData.from,
      ethAmountWei: amountWei.toString(),
      tier,
      huntLimit,
      huntsUsed: 0,
      expiresAt,
      isSponsor,
    })
    .returning();

  req.log.info({ ip, tier, amountWei: amountWei.toString() }, "Donation verified and recorded");

  res.json(GetDonationStatusResponse.parse(buildDonationStatus(donor)));
});

export default router;
