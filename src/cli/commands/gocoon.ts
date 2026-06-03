import type { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import {
  ensureGocoonBinaries,
  init,
  isInstalled,
  runnerBaseUrl,
  topup,
  waitFunded,
  walletInfo,
  withdrawAll,
  GOCOON_DEFAULT_PORT,
  GOCOON_VERSION,
  type GocoonProgress,
} from "../../gocoon/index.js";
import { BOLD, DIM, GREEN, RED, TON, YELLOW, noteBox } from "../prompts.js";
import { getErrorMessage } from "../../utils/errors.js";

/** Render a lifecycle progress event to the terminal. */
function renderProgress(e: GocoonProgress): void {
  const tag = DIM(`[${e.stage}]`);
  if (e.status === "ok") console.log(`  ${GREEN("✓")} ${tag} ${e.message}`);
  else if (e.status === "error") console.log(`  ${RED("✗")} ${tag} ${e.message}`);
  else if (e.status === "warn" || e.status === "skipped")
    console.log(`  ${YELLOW("•")} ${tag} ${e.message}`);
  else console.log(`  ${TON("›")} ${tag} ${e.message}`);
}

const indent = (line: string): void => console.log(DIM("  " + line));

/** `teleton gocoon init` — install gocoon, generate the COCOON wallet, fund it. */
async function runInit(): Promise<void> {
  console.log(BOLD(TON("\n  Gocoon setup — decentralized LLM on TON\n")));

  console.log(`  ${TON("›")} Installing gocoon ${GOCOON_VERSION}…`);
  await ensureGocoonBinaries();
  console.log(`  ${GREEN("✓")} Binaries ready`);

  console.log(`  ${TON("›")} Generating COCOON wallet…`);
  const summary = await init();
  console.log(`  ${GREEN("✓")} Wallet ready`);

  noteBox(
    `Send ${BOLD(summary.recommendedFundingTon + " TON")} (mainnet) to:\n\n` +
      `  ${summary.fundAddress}\n\n` +
      `This stakes your COCOON payment channel. Funds are recoverable later with\n` +
      DIM("teleton gocoon withdraw <your-address>"),
    "Fund COCOON wallet",
    YELLOW
  );

  const sent = await confirm({ message: "Have you sent the TON?", default: false });
  if (!sent) {
    console.log(YELLOW("\n  Setup paused — run `teleton gocoon init` again once funded.\n"));
    return;
  }

  console.log(`  ${TON("›")} Waiting for funding to confirm on-chain…`);
  await waitFunded(indent);
  console.log(`  ${GREEN("✓")} Wallet funded`);

  noteBox(
    `Set ${BOLD("agent.provider: gocoon")} in your config.\n` +
      `On ${BOLD("teleton start")} the runner launches automatically.`,
    "Gocoon ready",
    GREEN
  );
}

async function runTopup(amountTon: string): Promise<void> {
  await topup(amountTon, GOCOON_DEFAULT_PORT, indent);
  console.log(`  ${GREEN("✓")} Topped up channel with ${amountTon} TON`);
}

async function runWithdraw(destination: string, skipConfirm: boolean): Promise<void> {
  if (!skipConfirm) {
    const ok = await confirm({
      message: `Withdraw EVERYTHING to ${destination}? Closes the channel and drains the COCOON + agent wallets. Irreversible.`,
      default: false,
    });
    if (!ok) {
      console.log(YELLOW("\n  Withdraw cancelled.\n"));
      return;
    }
  }
  console.log();
  await withdrawAll(destination, renderProgress);
}

async function runStatus(): Promise<void> {
  console.log(BOLD("\n  Gocoon status\n"));
  const installed = isInstalled();
  console.log(
    `  Installed:     ${installed ? GREEN(GOCOON_VERSION) : YELLOW("not installed — run `teleton gocoon init`")}`
  );

  // Only read the wallet when installed — avoids a surprise download on a read-only status.
  if (installed) {
    try {
      const info = await walletInfo();
      console.log(`  COCOON wallet: ${info.ownerAddress}`);
      console.log(
        `  Balance:       ${info.balanceTon} TON  ${info.funded ? GREEN("(funded)") : YELLOW("(not funded)")}`
      );
    } catch {
      console.log(`  COCOON wallet: ${DIM("not set up — run `teleton gocoon init`")}`);
    }
  }

  const up = await fetch(`${runnerBaseUrl()}/jsonstats`, { signal: AbortSignal.timeout(800) })
    .then(() => true)
    .catch(() => false);
  console.log(`  Runner:        ${up ? GREEN("running") : DIM("not running")}\n`);
}

/** Wrap a command action: report errors cleanly and exit non-zero. */
async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(RED(`\n  ✗ ${getErrorMessage(err)}\n`));
    process.exit(1);
  }
}

/** Register the `teleton gocoon` command group. */
export function registerGocoonCommand(program: Command): void {
  const gocoon = program
    .command("gocoon")
    .description("Manage gocoon — decentralized LLM on TON (install, setup, top-up, withdraw)")
    .option("-i, --init", "Install and set up gocoon (wallet + funding)")
    .action(async (opts: { init?: boolean }) => {
      if (opts.init) {
        await guard(runInit);
        return;
      }
      gocoon.help();
    });

  gocoon
    .command("init")
    .alias("i")
    .description("Install gocoon and set up the COCOON wallet + funding")
    .action(() => guard(runInit));

  gocoon
    .command("topup")
    .description("Add TON to the payment channel (the runner must be active)")
    .requiredOption("--amount <ton>", "Amount in TON to add (e.g. 5)")
    .action((opts: { amount: string }) => guard(() => runTopup(opts.amount)));

  gocoon
    .command("withdraw <destination>")
    .description(
      "Close the channel + withdraw COCOON & agent wallets to <destination> (TON address or .ton)"
    )
    .option("--yes", "Skip the confirmation prompt")
    .action((destination: string, opts: { yes?: boolean }) =>
      guard(() => runWithdraw(destination, Boolean(opts.yes)))
    );

  gocoon
    .command("status")
    .description("Show gocoon install + wallet + runner status")
    .action(() => guard(runStatus));
}
