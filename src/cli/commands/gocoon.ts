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

function renderProgress(e: GocoonProgress): void {
  const tag = DIM(`[${e.stage}]`);
  if (e.status === "ok") console.log(`  ${GREEN("ok")} ${tag} ${e.message}`);
  else if (e.status === "error") console.log(`  ${RED("x")} ${tag} ${e.message}`);
  else if (e.status === "warn" || e.status === "skipped")
    console.log(`  ${YELLOW("-")} ${tag} ${e.message}`);
  else console.log(`  ${TON(">")} ${tag} ${e.message}`);
}

const indent = (line: string): void => console.log(DIM("  " + line));

async function runInit(): Promise<void> {
  console.log(BOLD(TON("\n  Gocoon setup\n")));

  console.log(`  ${TON(">")} Installing gocoon ${GOCOON_VERSION}`);
  await ensureGocoonBinaries();
  console.log(`  ${GREEN("ok")} Binaries ready`);

  console.log(`  ${TON(">")} Preparing COCOON wallet`);
  const summary = await init();
  console.log(`  ${GREEN("ok")} Wallet ready`);

  noteBox(
    `Send ${BOLD(summary.recommendedFundingTon + " TON")} (mainnet) to:\n\n` +
      `  ${summary.fundAddress}\n\n` +
      `This stakes your COCOON payment channel. Recoverable later with\n` +
      DIM("teleton gocoon withdraw <your-address>"),
    "Fund COCOON wallet",
    YELLOW
  );

  const sent = await confirm({ message: "Have you sent the TON?", default: false });
  if (!sent) {
    console.log(YELLOW("\n  Setup paused. Run `teleton gocoon init` again once funded.\n"));
    return;
  }

  console.log(`  ${TON(">")} Waiting for funding to confirm on-chain`);
  await waitFunded(indent);
  console.log(`  ${GREEN("ok")} Wallet funded`);

  noteBox(
    `Set ${BOLD("agent.provider: gocoon")} in your config.\n` +
      `On ${BOLD("teleton start")} the runner launches automatically.`,
    "Gocoon ready",
    GREEN
  );
}

async function runTopup(amountTon: string): Promise<void> {
  await topup(amountTon, GOCOON_DEFAULT_PORT, indent);
  console.log(`  ${GREEN("ok")} Topped up channel with ${amountTon} TON`);
}

async function runWithdraw(destination: string, skipConfirm: boolean): Promise<void> {
  if (!skipConfirm) {
    const ok = await confirm({
      message: `Withdraw everything to ${destination}? Closes the channel and drains the COCOON + agent wallets. Irreversible.`,
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
  console.log(`  Installed:     ${installed ? GREEN(GOCOON_VERSION) : YELLOW("not installed")}`);

  if (installed) {
    try {
      const info = await walletInfo();
      console.log(`  COCOON wallet: ${info.ownerAddress}`);
      console.log(`  Balance:       ${info.balanceTon} TON`);
    } catch {
      console.log(`  COCOON wallet: ${DIM("not set up, run `teleton gocoon init`")}`);
    }
  }

  const up = await fetch(`${runnerBaseUrl()}/jsonstats`, { signal: AbortSignal.timeout(800) })
    .then(() => true)
    .catch(() => false);
  console.log(`  Runner:        ${up ? GREEN("running") : DIM("not running")}\n`);
}

async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(RED(`\n  ${getErrorMessage(err)}\n`));
    process.exit(1);
  }
}

export function registerGocoonCommand(program: Command): void {
  const gocoon = program
    .command("gocoon")
    .description("Manage gocoon (decentralized LLM on TON): install, setup, top-up, withdraw")
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
    .description("Close the channel and withdraw COCOON + agent wallets to <destination>")
    .option("--yes", "Skip the confirmation prompt")
    .action((destination: string, opts: { yes?: boolean }) =>
      guard(() => runWithdraw(destination, Boolean(opts.yes)))
    );

  gocoon
    .command("status")
    .description("Show gocoon install + wallet + runner status")
    .action(() => guard(runStatus));
}
