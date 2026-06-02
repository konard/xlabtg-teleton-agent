import { PoolType, ReadinessStatus } from "@dedust/sdk";
import type { Factory, Asset, Pool } from "@dedust/sdk";
import type { OpenedContract, TonClient } from "@ton/ton";

export interface DedustPoolMatch {
  pool: OpenedContract<Pool>;
  poolType: "volatile" | "stable";
}

/**
 * Find the best READY DeDust pool for an asset pair. Tries `preferred` first
 * (default "volatile"), then falls back to the other type, else null. Single
 * definition so quote and swap agree on selection (swap previously tried only the
 * requested type with no fallback, so quote could recommend a pool swap rejected).
 */
export async function findDedustPool(
  tonClient: TonClient,
  factory: OpenedContract<Factory>,
  fromAsset: Asset,
  toAsset: Asset,
  preferred: "volatile" | "stable" = "volatile"
): Promise<DedustPoolMatch | null> {
  const order: Array<"volatile" | "stable"> =
    preferred === "stable" ? ["stable", "volatile"] : ["volatile", "stable"];
  try {
    for (const type of order) {
      const poolTypeEnum = type === "stable" ? PoolType.STABLE : PoolType.VOLATILE;
      const pool = tonClient.open(await factory.getPool(poolTypeEnum, [fromAsset, toAsset]));
      if ((await pool.getReadinessStatus()) === ReadinessStatus.READY) {
        return { pool, poolType: type };
      }
    }
    return null;
  } catch {
    return null;
  }
}
