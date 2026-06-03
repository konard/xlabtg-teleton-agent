import { spawn, type ChildProcess } from "child_process";
import { Address, fromNano, internal, SendMode } from "@ton/core";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errors.js";
import { tonapiFetch } from "../constants/api-endpoints.js";
import { getCachedTonClient } from "../ton/wallet-service.js";
import { openWallet } from "../ton/wallet-open.js";
import { sendWalletTx } from "../ton/confirm.js";
import { ensureGocoonBinaries } from "./installer.js";
import {
  fetchClientSC,
  gocoonInit,
  streamGocoon,
  tonToNano,
  waitFunded,
  walletInfo,
  type InitSummary,
  type WalletInfo,
} from "./cli.js";
import { killProcessGroup, waitReady } from "./supervisor.js";
import {
  GOCOON_DEFAULT_PORT,
  clientConfigPath,
  runnerBaseUrl,
  runnerBin,
  walletPath,
} from "./paths.js";

const log = createLogger("gocoon");

export { gocoonInit as init, waitFunded, walletInfo, tonToNano };
export type { InitSummary, WalletInfo };

export type GocoonStage =
  | "resolve"
  | "find_channel"
  | "spawn_runner"
  | "close_channel"
  | "wait_refund"
  | "withdraw_cocoon"
  | "withdraw_agent"
  | "complete";

export type GocoonStatus = "started" | "ok" | "info" | "warn" | "skipped" | "error";

export interface GocoonProgress {
  stage: GocoonStage;
  status: GocoonStatus;
  message: string;
  at: number;
}

export type ProgressSink = (e: GocoonProgress) => void;

const REFUND_TIMEOUT_MS = 180_000;
const REFUND_MIN_DELTA_NANO = 5_000_000_000n;
const MIN_COCOON_WITHDRAW_NANO = 50_000_000n;
const AGENT_FEE_BUFFER_NANO = 10_000_000n;
const COCOON_CLIENT_OPS = new Set([
  "CocoonOwnerClientRegister",
  "CocoonExtClientTopUp",
  "CocoonOwnerRequestRefund",
  "CocoonOwnerWithdraw",
]);

// Add TON to the open channel. The runner must be active (reads client_sc from /jsonstats).
export async function topup(
  amountTon: string,
  port: number = GOCOON_DEFAULT_PORT,
  onLine?: (line: string) => void
): Promise<void> {
  const nano = tonToNano(amountTon);
  const clientSC = await fetchClientSC(port);
  log.info(`Topping up channel with ${amountTon} TON (${nano} nanoTON)`);
  await streamGocoon(["channel", "topup", "--amount", nano, "--client-sc", clientSC], onLine);
}

// Close the channel, wait for the refund, then withdraw the COCOON and agent
// wallets to destination. The runner must not be running.
export async function withdrawAll(
  destination: string,
  sink: ProgressSink = () => {},
  port: number = GOCOON_DEFAULT_PORT
): Promise<void> {
  const emit = (stage: GocoonStage, status: GocoonStatus, message: string): void =>
    sink({ stage, status, message, at: Date.now() });

  emit("resolve", "started", "Resolving destination");
  const dest = await resolveDest(destination);
  emit("resolve", "ok", `Destination: ${dest.label}`);

  if (await isRunnerUp(port)) {
    throw new Error("the gocoon runner is active; stop teleton first, then retry the withdraw");
  }

  const cocoon = await walletInfo();
  emit(
    "find_channel",
    "started",
    `Looking for an active channel via ${shortAddr(cocoon.ownerAddress)}`
  );
  let clientSC: string | null = null;
  try {
    clientSC = await findClientSC(cocoon.ownerAddress);
    emit("find_channel", "ok", "Channel located");
  } catch (err) {
    emit(
      "find_channel",
      "skipped",
      `No active channel, will only withdraw wallets (${getErrorMessage(err)})`
    );
  }

  if (clientSC) {
    emit("spawn_runner", "started", "Starting gocoon-runner (transient)");
    const runner = await spawnTransientRunner();
    try {
      await waitReady(`${runnerBaseUrl(port)}/jsonstats`, 30_000);
      emit("spawn_runner", "ok", "Runner ready");

      emit("close_channel", "started", "Closing channel");
      await streamGocoon([
        "channel",
        "close",
        "--client-sc",
        clientSC,
        "--url",
        runnerBaseUrl(port),
      ]);
      emit("close_channel", "ok", "Channel close transaction sent");

      emit("wait_refund", "started", "Waiting for the staked TON to return (up to 3 min)");
      await waitForRefund(REFUND_TIMEOUT_MS);
      emit("wait_refund", "ok", "Refund landed on chain");
    } finally {
      if (runner.pid != null) killProcessGroup(runner.pid);
    }
  }

  const balance = (await walletInfo()).balanceNano;
  if (balance > MIN_COCOON_WITHDRAW_NANO) {
    emit("withdraw_cocoon", "started", `Withdrawing COCOON wallet to ${dest.label}`);
    await streamGocoon([
      "wallet",
      "withdraw",
      "--wallet",
      walletPath(),
      "--config",
      clientConfigPath(),
      "--to",
      dest.address.toString({ bounceable: false }),
    ]);
    emit("withdraw_cocoon", "ok", "COCOON wallet withdrawn");
  } else {
    emit("withdraw_cocoon", "skipped", `COCOON wallet too low (${balance} nanoTON), skipping`);
  }

  emit("withdraw_agent", "started", `Withdrawing agent wallet to ${dest.label}`);
  await withdrawAgentWallet(dest.address, emit);

  emit("complete", "ok", `All funds sent to ${dest.label}`);
}

interface ResolvedDest {
  address: Address;
  label: string;
}

// Accept a TON address or a .ton domain.
async function resolveDest(raw: string): Promise<ResolvedDest> {
  const s = raw.trim();
  if (!s) throw new Error("empty destination");
  if (s.toLowerCase().endsWith(".ton")) {
    const res = await tonapiFetch(`/dns/${encodeURIComponent(s.toLowerCase())}/resolve`);
    if (!res.ok) throw new Error(`tonapi dns resolve ${s} returned HTTP ${res.status}`);
    const j = (await res.json()) as { wallet?: { address?: string } };
    const addr = j.wallet?.address;
    if (!addr) throw new Error(`${s} has no wallet record`);
    return { address: Address.parse(addr), label: `${s} (${shortAddr(addr)})` };
  }
  try {
    return { address: Address.parse(s), label: s };
  } catch {
    throw new Error(`not a TON address or .ton domain: "${raw}"`);
  }
}

async function isRunnerUp(port: number): Promise<boolean> {
  try {
    await fetch(`${runnerBaseUrl(port)}/jsonstats`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

// Find the client_sc this wallet interacted with on chain, and verify it is active.
async function findClientSC(walletAddr: string): Promise<string> {
  const res = await tonapiFetch(`/accounts/${encodeURIComponent(walletAddr)}/events?limit=50`);
  if (!res.ok) throw new Error(`tonapi events returned HTTP ${res.status}`);
  const j = (await res.json()) as {
    events?: {
      actions?: {
        type?: string;
        SmartContractExec?: {
          executor?: { address?: string };
          contract?: { address?: string };
          operation?: string;
        };
      }[];
    }[];
  };

  const me = normalizeRaw(walletAddr);
  let candidate: string | undefined;
  for (const event of j.events ?? []) {
    for (const action of event.actions ?? []) {
      const exec = action.SmartContractExec;
      if (action.type !== "SmartContractExec" || !exec) continue;
      if (normalizeRaw(exec.executor?.address ?? "") !== me) continue;
      if (!COCOON_CLIENT_OPS.has(exec.operation ?? "")) continue;
      candidate = exec.contract?.address;
      break;
    }
    if (candidate) break;
  }
  if (!candidate) {
    throw new Error("no cocoon_client interaction found; channel may never have been staked");
  }

  const stat = await tonapiFetch(`/accounts/${encodeURIComponent(candidate)}`);
  if (!stat.ok) throw new Error(`tonapi account returned HTTP ${stat.status}`);
  const status = ((await stat.json()) as { status?: string }).status ?? "unknown";
  if (status !== "active") throw new Error(`client_sc is ${status} (already closed?)`);

  return Address.parse(candidate).toString({ bounceable: false });
}

// Poll the COCOON wallet balance until it grows by at least 5 TON (the refund).
async function waitForRefund(timeoutMs: number): Promise<void> {
  const baseline = (await walletInfo()).balanceNano;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      const now = (await walletInfo()).balanceNano;
      if (now > baseline && now - baseline >= REFUND_MIN_DELTA_NANO) return;
    } catch {
      /* transient RPC error */
    }
  }
  throw new Error(`refund did not land within ${Math.round(timeoutMs / 1000)}s`);
}

// Send (balance - 0.01 TON) from teleton's agent wallet to dest. Skips if empty.
async function withdrawAgentWallet(
  dest: Address,
  emit: (stage: GocoonStage, status: GocoonStatus, message: string) => void
): Promise<void> {
  const client = await getCachedTonClient();
  const opened = await openWallet(client);
  if (!opened) {
    emit("withdraw_agent", "skipped", "No agent wallet on disk, skipping");
    return;
  }
  const balance = await client.getBalance(opened.contract.address);
  const send = balance - AGENT_FEE_BUFFER_NANO;
  if (send <= 0n) {
    emit("withdraw_agent", "skipped", `Agent wallet too low (${balance} nanoTON), skipping`);
    return;
  }
  const sent = await sendWalletTx(client, opened.contract, {
    secretKey: opened.keyPair.secretKey,
    messages: [internal({ to: dest, value: send, bounce: false, body: "withdraw" })],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });
  if (!sent) throw new Error("agent wallet transfer was not confirmed on-chain");
  emit("withdraw_agent", "ok", `Agent wallet withdrawn (${fromNano(send)} TON sent)`);
}

async function spawnTransientRunner(): Promise<ChildProcess> {
  await ensureGocoonBinaries();
  return spawn(runnerBin(), ["--config", clientConfigPath()], { detached: true, stdio: "ignore" });
}

function normalizeRaw(s: string): string {
  try {
    const a = Address.parse(s);
    return `${a.workChain}:${a.hash.toString("hex")}`.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function shortAddr(s: string): string {
  return s.length > 18 ? `${s.slice(0, 8)}...${s.slice(-6)}` : s;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
